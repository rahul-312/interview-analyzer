import logging

from celery import shared_task

from . import razorpay, services

logger = logging.getLogger(__name__)


@shared_task(bind=True, max_retries=5, default_retry_delay=60, retry_backoff=True)
def finish_replacement_task(self, sub_id):
    """
    Finishes a paid upgrade's replacement (services.finish_replacement), retrying while Razorpay
    can't be reached. Without a broker it runs once, inline: reconcile_subscriptions retries it.
    """
    try:
        services.finish_replacement(sub_id)
    except razorpay.RazorpayError as exc:
        if self.request.is_eager:
            logger.warning("Upgrade %s not finished yet, reconcile will retry: %s", sub_id, exc.description)
            return
        raise self.retry(exc=exc)
