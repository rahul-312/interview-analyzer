from django.conf import settings
from django.db import models


class Profile(models.Model):
    """Per-user settings. Every user is on the free plan until switched (in the admin)."""

    class Plan(models.TextChoices):
        FREE = "free", "Free"
        PRO = "pro", "Pro"

    user = models.OneToOneField(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="profile")
    plan = models.CharField(max_length=10, choices=Plan.choices, default=Plan.FREE)

    def __str__(self):
        return f"{self.user} ({self.get_plan_display()})"


def get_profile(user):
    """The user's profile, created on first use so existing users get one too."""
    profile, _ = Profile.objects.get_or_create(user=user)
    return profile
