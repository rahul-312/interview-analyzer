from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from billing import razorpay, services
from billing.models import PaymentTransaction, SubscriptionStatus, TERMINAL_STATUSES, UserSubscription


REFUND_SETTLE_DELAY = timedelta(minutes=10)


class Command(BaseCommand):
    help = (
        "Fetches every open subscription from Razorpay and applies its state, in case webhooks were missed. "
        "Checkouts still not completed after a day are cancelled at Razorpay and marked expired. "
        "Money-back refunds not yet made, or still processing, are made or synced. "
        "Safe to run as often as you like (e.g. hourly cron)."
    )

    def handle(self, *args, **options):
        stale = timezone.now() - services.CHECKOUT_EXPIRY
        synced = failed = expired = 0
        for sub in UserSubscription.objects.exclude(status__in=TERMINAL_STATUSES).iterator():
            try:
                # Razorpay's word first: a checkout that looks abandoned here may have been paid.
                sub = services.reconcile(sub)
                synced += 1
                if sub.status == SubscriptionStatus.CREATED and sub.created_at < stale and services.abandon_checkout(sub):
                    expired += 1
            except razorpay.RazorpayError as exc:
                failed += 1
                self.stderr.write(f"{sub.razorpay_subscription_id}: {exc.description}")
        refunds = refund_failed = 0
        # A refund requested in the last few minutes is left to the cancel that's making it, so the
        # two don't race to Razorpay (only Razorpay's refusal of a second refund would stop that).
        open_refunds = PaymentTransaction.objects.filter(
            Q(refund_status=PaymentTransaction.RefundStatus.PENDING)
            | Q(refund_status=PaymentTransaction.RefundStatus.REQUESTED, refund_requested_at__lt=timezone.now() - REFUND_SETTLE_DELAY)
        )
        for payment in open_refunds.iterator():
            try:
                services.settle_refund(payment)
                refunds += 1
            except razorpay.RazorpayError as exc:
                refund_failed += 1
                self.stderr.write(f"{payment.razorpay_payment_id} refund: {exc.description}")
        self.stdout.write(
            f"Synced {synced}, failed {failed}, expired {expired} abandoned checkouts. "
            f"Refunds synced {refunds}, failed {refund_failed}."
        )
