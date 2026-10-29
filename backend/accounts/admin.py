from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    list_display = ["user", "plan"]
    list_filter = ["plan"]
    list_editable = ["plan"]
    search_fields = ["user__username", "user__email"]
