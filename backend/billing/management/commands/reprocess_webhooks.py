from django.core.management.base import BaseCommand

from billing import webhooks
from billing.models import WebhookEvent


class Command(BaseCommand):
    help = "Applies failed Razorpay webhook events again from what was stored (contact and card details are not kept)."

    def add_arguments(self, parser):
        parser.add_argument("event_ids", nargs="*", help="Only these events (default: every failed one).")

    def handle(self, *args, event_ids=(), **options):
        events = WebhookEvent.objects.filter(status=WebhookEvent.Status.FAILED)
        if event_ids:
            events = events.filter(event_id__in=event_ids)
        for event in events:
            result = webhooks.handle(event.event_id, event.payload)
            self.stdout.write(f"{event.event_id} ({event.event_type}): {result.status} {result.error}".rstrip())
