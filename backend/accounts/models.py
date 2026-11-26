from django.conf import settings
from django.db import models


class Profile(models.Model):
    """
    Per-user settings. `plan` is a complimentary plan set in the admin (everyone starts on Free);
    paid plans come from Razorpay subscriptions. Users get whichever of the two is higher: see
    billing.entitlements. `tester` lifts the usage limits for people trying the app out.
    """

    class Plan(models.TextChoices):
        FREE = "free", "Free"
        PRO = "pro", "Pro"
        PRO_PLUS = "pro_plus", "Pro Plus"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    plan = models.CharField(max_length=10, choices=Plan.choices, default=Plan.FREE)
    tester = models.BooleanField(
        default=False,
        help_text="Their plan's allowance shows as full (e.g. 2/2 analyses left) until they reach "
        "TESTER_JOBS_PER_24H of a kind of job (or the plan's limit, if higher). For testing the app or "
        "recording demos. Superusers only.",
    )

    def __str__(self):
        return f"{self.user} ({self.get_plan_display()})"


def get_profile(user):
    """The user's profile, created on first use so existing users get one too."""
    profile, _ = Profile.objects.get_or_create(user=user)
    return profile
