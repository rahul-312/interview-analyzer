import logging

from celery import shared_task

from . import razorpay, services

logger = logging.getLogger(__name__)


RETRY_DELAY_SECONDS = 60


@shared_task(bind=True, max_retries=5)
def finish_replacement_task(self, sub_id):
    """
    Finishes a paid upgrade's replacement (services.finish_replacement), retrying while Razorpay
    can't be reached: after 1, 2, 4, 8 and 16 minutes, so about half an hour in all, before it's left
    to the hourly reconcile_subscriptions. Without a broker it runs once, inline.
    """
    try:
        services.finish_replacement(sub_id)
    except razorpay.RazorpayError as exc:
        if self.request.is_eager:
            logger.warning("Upgrade %s not finished yet, reconcile will retry: %s", sub_id, exc.description)
            return
        raise self.retry(exc=exc, countdown=RETRY_DELAY_SECONDS * 2 ** self.request.retries)
