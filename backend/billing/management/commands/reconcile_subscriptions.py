from datetime import timedelta

from django.core.management.base import BaseCommand
from django.utils import timezone

from billing import razorpay, services
from billing.models import SubscriptionStatus, TERMINAL_STATUSES, UserSubscription


class Command(BaseCommand):
    help = (
        "Fetches every open subscription from Razorpay and applies its state, in case webhooks were missed. "
        "Checkouts never completed within a day are marked expired. Safe to run as often as you like (e.g. hourly cron)."
    )

    def handle(self, *args, **options):
        stale = timezone.now() - timedelta(days=1)
        expired = UserSubscription.objects.filter(status=SubscriptionStatus.CREATED, created_at__lt=stale)
        to_check = UserSubscription.objects.exclude(status__in=TERMINAL_STATUSES).exclude(pk__in=expired.values("pk"))
        synced = failed = 0
        for sub in to_check.iterator():
            try:
                services.reconcile(sub)
                synced += 1
            except razorpay.RazorpayError as exc:
                failed += 1
                self.stderr.write(f"{sub.razorpay_subscription_id}: {exc.description}")
        count = expired.update(status=SubscriptionStatus.EXPIRED)
        self.stdout.write(f"Synced {synced}, failed {failed}, expired {count} abandoned checkouts.")
