from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "plan", "tester"]
    list_filter = ["plan", "tester"]
    list_editable = ["plan", "tester"]
    search_fields = ["user__username", "user__email"]
