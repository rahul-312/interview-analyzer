from django.conf import settings
from django.db import migrations


def create_missing_profiles(apps, schema_editor):
    """Users who signed up before profiles existed get a free profile."""
    User = apps.get_model(*settings.AUTH_USER_MODEL.split("."))
    Profile = apps.get_model("accounts", "Profile")
    Profile.objects.bulk_create(
        [Profile(user_id=user_id, plan="free") for user_id in User.objects.filter(profile__isnull=True).values_list("id", flat=True)]
    )


class Migration(migrations.Migration):
    dependencies = [
        ("accounts", "0001_initial"),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [migrations.RunPython(create_missing_profiles, migrations.RunPython.noop)]
