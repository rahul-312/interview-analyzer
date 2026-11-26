from django.contrib import admin

from .models import Profile


@admin.register(Profile)
class ProfileAdmin(admin.ModelAdmin):
    """`tester` lifts the AI usage limits (up to a high cap), so only superusers can change it."""

    list_display = ["user", "plan", "tester"]
    list_filter = ["plan", "tester"]
    list_editable = ["plan"]
    search_fields = ["user__username", "user__email"]
    actions = ["make_testers", "remove_testers"]

    def get_readonly_fields(self, request, obj=None):
        fields = list(super().get_readonly_fields(request, obj))
        return fields if request.user.is_superuser else [*fields, "tester"]

    def has_superuser_permission(self, request):
        return request.user.is_superuser

    @admin.action(description="Make the selected users testers", permissions=["superuser"])
    def make_testers(self, request, queryset):
        self._set_tester(request, queryset, True)

    @admin.action(description="Stop the selected users being testers", permissions=["superuser"])
    def remove_testers(self, request, queryset):
        self._set_tester(request, queryset, False)

    def _set_tester(self, request, queryset, value):
        # Saved one by one, so each change is in the admin's history like an edit.
        for profile in queryset.exclude(tester=value):
            profile.tester = value
            profile.save(update_fields=["tester"])
            self.log_change(request, profile, [{"changed": {"fields": ["tester"]}}])
