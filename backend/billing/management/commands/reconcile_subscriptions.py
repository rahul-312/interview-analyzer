import logging
from datetime import timedelta

from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from billing import razorpay, services
from billing.models import PaymentTransaction, ReplacementStatus, SubscriptionStatus, TERMINAL_STATUSES, UserSubscription


logger = logging.getLogger(__name__)

REFUND_SETTLE_DELAY = timedelta(minutes=10)
REFUND_STUCK_AFTER = timedelta(hours=1)
REFUND_PENDING_TOO_LONG = timedelta(days=10)
REPLACEMENT_STUCK_AFTER = timedelta(hours=1)


class Command(BaseCommand):
    help = (
        "Fetches every open subscription from Razorpay and applies its state, in case webhooks were missed. "
        "Checkouts still not completed after a day are cancelled at Razorpay and marked expired. "
        "Upgrades whose old plan isn't cancelled or credited yet are finished. "
        "Refunds not yet made, or still processing, are made or synced. "
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
        replaced = replace_failed = 0
        for sub in UserSubscription.objects.filter(replacement_status=ReplacementStatus.FINISHING).iterator():
            try:
                services.finish_replacement(sub.pk)
                replaced += 1
            except razorpay.RazorpayError as exc:
                replace_failed += 1
                self.stderr.write(f"{sub.razorpay_subscription_id} upgrade: {exc.description}")
        refunds = refund_failed = 0
        now = timezone.now()
        # A refund requested in the last few minutes is left to the action that's making it, and one
        # claimed recently to the attempt holding the claim.
        open_refunds = PaymentTransaction.objects.filter(
            Q(refund_status=PaymentTransaction.RefundStatus.PENDING)
            | Q(refund_status=PaymentTransaction.RefundStatus.REQUESTED, refund_requested_at__lt=now - REFUND_SETTLE_DELAY)
            | Q(refund_status=PaymentTransaction.RefundStatus.SENDING, refund_claimed_at__lt=now - services.REFUND_CLAIM_TIMEOUT)
        )
        for payment in open_refunds.iterator():
            try:
                services.settle_refund(payment)
                refunds += 1
            except razorpay.RazorpayError as exc:
                refund_failed += 1
                self.stderr.write(f"{payment.razorpay_payment_id} refund: {exc.description}")
        # The user is being told these are on their way, so say so loudly. Not made after an hour
        # usually means a setup problem such as bad API keys; Razorpay normally finishes one in 5–7
        # working days.
        now = timezone.now()
        stuck_ids = list(PaymentTransaction.objects.filter(
            Q(refund_status__in=[PaymentTransaction.RefundStatus.REQUESTED, PaymentTransaction.RefundStatus.SENDING],
              refund_requested_at__lt=now - REFUND_STUCK_AFTER)
            | Q(refund_status=PaymentTransaction.RefundStatus.PENDING, refund_requested_at__lt=now - REFUND_PENDING_TOO_LONG)
        ).order_by("refund_requested_at").values_list("razorpay_payment_id", flat=True))
        stuck = len(stuck_ids)
        if stuck:
            shown = ", ".join(stuck_ids[:5]) + (", ..." if stuck > 5 else "")
            logger.error("%s refund(s) stuck (not made after an hour, or unfinished after 10 days): %s", stuck, shown)
            self.stderr.write(f"{stuck} refund(s) stuck: {shown}. Check the Razorpay keys, log and Dashboard.")
        # An upgrade left unfinished has two plans running: the old one may renew and charge again.
        unfinished = list(UserSubscription.objects.filter(
            Q(replacement_status=ReplacementStatus.FINISHING, credit_from__lt=now - REPLACEMENT_STUCK_AFTER)
            | Q(replacement_status=ReplacementStatus.NEEDS_ATTENTION)
        ).values_list("razorpay_subscription_id", flat=True))
        if unfinished:
            shown = ", ".join(unfinished[:5]) + (", ..." if len(unfinished) > 5 else "")
            logger.error("%s upgrade(s) unfinished (old plan not cancelled or credited): %s", len(unfinished), shown)
            self.stderr.write(f"{len(unfinished)} upgrade(s) unfinished: {shown}. See replacement_error in the admin.")
        self.stdout.write(
            f"Synced {synced}, failed {failed}, expired {expired} abandoned checkouts. "
            f"Upgrades finished {replaced}, failed {replace_failed}, unfinished {len(unfinished)}. "
            f"Refunds synced {refunds}, failed {refund_failed}, stuck {stuck}."
        )
