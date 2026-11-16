from django.db import migrations

# Prices in paise. Razorpay plan IDs are linked per environment with `manage.py setup_razorpay_plans`.
PLANS = [
    ("pro_monthly", "pro", "month", 19900),
    ("pro_yearly", "pro", "year", 169900),
    ("pro_plus_monthly", "pro_plus", "month", 49900),
    ("pro_plus_yearly", "pro_plus", "year", 399900),
]


def seed(apps, schema_editor):
    SubscriptionPlan = apps.get_model("billing", "SubscriptionPlan")
    for code, tier, interval, price in PLANS:
        SubscriptionPlan.objects.get_or_create(code=code, defaults={"tier": tier, "interval": interval, "price_paise": price})


def unseed(apps, schema_editor):
    apps.get_model("billing", "SubscriptionPlan").objects.filter(code__in=[p[0] for p in PLANS], subscriptions=None).delete()


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial")]

    operations = [migrations.RunPython(seed, unseed)]
