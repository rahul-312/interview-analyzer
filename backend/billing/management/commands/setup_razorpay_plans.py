import os

from django.core.management.base import BaseCommand, CommandError

from billing import razorpay
from billing.models import SubscriptionPlan


class Command(BaseCommand):
    help = (
        "Links each active plan to a Razorpay plan: uses RAZORPAY_PLAN_<CODE> (e.g. RAZORPAY_PLAN_PRO_MONTHLY) "
        "when set, otherwise creates the plan in Razorpay. Run once per environment (test and live keys have "
        "separate plans)."
    )

    def add_arguments(self, parser):
        parser.add_argument("--dry-run", action="store_true", help="Show what would be done without calling Razorpay.")

    def handle(self, *args, dry_run=False, **options):
        if not razorpay.enabled() and not dry_run:
            raise CommandError("Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET first.")
        for plan in SubscriptionPlan.objects.filter(is_active=True, razorpay_plan_id=""):
            from_env = os.environ.get(f"RAZORPAY_PLAN_{plan.code.upper()}", "")
            if dry_run:
                self.stdout.write(f"{plan.code}: would {'use ' + from_env if from_env else 'create a Razorpay plan'}")
                continue
            if from_env:
                plan.razorpay_plan_id = from_env
            else:
                entity = razorpay.create_plan(
                    interval=plan.interval, amount_paise=plan.price_paise, currency=plan.currency,
                    name=f"Interview Analyzer {plan.get_tier_display()} ({plan.get_interval_display()})",
                )
                plan.razorpay_plan_id = entity["id"]
            plan.save(update_fields=["razorpay_plan_id", "updated_at"])
            self.stdout.write(self.style.SUCCESS(f"{plan.code}: {plan.razorpay_plan_id}"))
        self.stdout.write("All active plans are linked." if not dry_run else "Dry run: nothing changed.")
