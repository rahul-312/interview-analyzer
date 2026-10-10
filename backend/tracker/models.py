from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models
from django.utils import timezone


class JobStatus(models.TextChoices):
    """Status of something produced by a background job."""
    PENDING = "pending", "Pending"
    RUNNING = "running", "Running"
    DONE = "done", "Done"
    FAILED = "failed", "Failed"


class Application(models.Model):
    class Status(models.TextChoices):
        # Found and kept for later (e.g. from the browser extension), not applied to yet.
        SAVED = "saved", "Saved"
        APPLIED = "applied", "Applied"
        SCREENING = "screening", "Screening"
        INTERVIEW = "interview", "Interviewing"
        OFFER = "offer", "Offer"
        REJECTED = "rejected", "Rejected"
        WITHDRAWN = "withdrawn", "Withdrawn"

    class Source(models.TextChoices):
        COLD = "cold", "Cold apply"
        REFERRAL = "referral", "Referral"
        RECRUITER = "recruiter", "Recruiter"
        JOB_BOARD = "job_board", "Job board"
        OTHER = "other", "Other"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="applications")
    company = models.CharField(max_length=200)
    role = models.CharField(max_length=200)
    date_applied = models.DateField()
    status = models.CharField(max_length=20, choices=Status.choices, default=Status.APPLIED)
    # Job board links can be long (slug + id), so allow more than URLField's default 200.
    job_url = models.URLField(max_length=500, blank=True)
    salary = models.CharField(max_length=100, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, blank=True)
    contact = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    job_description = models.TextField(blank=True)
    # When the user actually applied. Empty while the job is only saved, and stays empty if a saved job
    # goes straight to rejected or withdrawn, so the funnel only counts real applications.
    # Kept up to date in save(): edits that skip it (QuerySet.update, bulk admin actions) don't set it.
    applied_at = models.DateField(null=True, blank=True)
    # When it was saved for later. date_applied becomes the applied date once it's applied to,
    # so this keeps the date it was saved.
    saved_at = models.DateField(null=True, blank=True)
    # The applied date of a job set back to Saved, put back if it's applied to again (undoing a
    # mistaken "Saved" shouldn't lose the real date). Internal: not in the API.
    previous_applied_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Moving a saved job to one of these means it was applied to.
    APPLIED_STATUSES = {Status.APPLIED, Status.SCREENING, Status.INTERVIEW, Status.OFFER}

    class Meta:
        ordering = ["-date_applied", "-created_at"]
        # The browser extension looks up the user's jobs by link.
        indexes = [models.Index(fields=["user", "job_url"], name="application_user_job_url")]

    def __str__(self):
        return f"{self.role} at {self.company}"

    @classmethod
    def from_db(cls, db, field_names, values):
        instance = super().from_db(db, field_names, values)
        instance._remember_loaded()
        return instance

    def refresh_from_db(self, *args, fields=None, **kwargs):
        super().refresh_from_db(*args, fields=fields, **kwargs)
        loaded = getattr(self, "_loaded", None) or {}
        for name in ("status", "date_applied"):
            if fields is None or name in fields:
                loaded[name] = self.__dict__.get(name)
        self._loaded = loaded

    def _remember_loaded(self):
        # What's in the database, so save() can tell what an edit changed without querying again.
        # (Deferred fields aren't in __dict__ and come out as None.) An edit is judged against the
        # values its instance was loaded with: if another request changed the status in between,
        # last write wins, as for every other field.
        self._loaded = {"status": self.__dict__.get("status"), "date_applied": self.__dict__.get("date_applied")}

    def _before(self):
        """Status and date as stored, from when this was loaded (or from the database if not known)."""
        loaded = getattr(self, "_loaded", None)
        if loaded is None or None in loaded.values():
            loaded = type(self).objects.filter(pk=self.pk).values("status", "date_applied").first() or {}
        return loaded

    def save(self, *args, **kwargs):
        changed = []
        saved = self.status == self.Status.SAVED
        if self._state.adding:
            if saved:
                self.saved_at = self.date_applied
            else:
                # Added directly with a later status (e.g. logging an old rejection): it was applied to.
                self.applied_at = self.date_applied
        else:
            before = self._before()
            date_edited = self.date_applied != before.get("date_applied")
            if saved and before.get("status") != self.Status.SAVED:
                # Set back to saved (often correcting a status picked by mistake): not applied after all.
                # Remember the applied date in case that's undone, and date the card as saved.
                if self.applied_at is not None:
                    self.previous_applied_at = self.applied_at
                    self.applied_at = None
                    changed += ["previous_applied_at", "applied_at"]
                if self.saved_at is None:
                    self.saved_at = self.date_applied if date_edited else timezone.localdate()
                    changed.append("saved_at")
                if not date_edited:
                    self.date_applied = self.saved_at
                    changed.append("date_applied")
            elif saved and self.saved_at is None:
                self.saved_at = self.date_applied  # saved before saved_at existed
                changed.append("saved_at")
            elif not saved and self.applied_at is None and (self.previous_applied_at or self.status in self.APPLIED_STATUSES):
                # Leaving Saved after a mistaken "Saved" (to any status, rejected included), or applying to
                # a saved job. The date is the one set in the same edit if any, else the applied date from
                # before the mistaken "Saved", else today (saved_at keeps the date it was saved).
                restoring = not date_edited and self.previous_applied_at is not None
                if not date_edited:
                    self.date_applied = self.previous_applied_at or timezone.localdate()
                    changed.append("date_applied")
                if restoring and self.saved_at and self.saved_at >= self.previous_applied_at:
                    # Only "saved" by the mistake being undone: it was never saved for later.
                    self.saved_at = None
                    changed.append("saved_at")
                self.applied_at = self.date_applied
                self.previous_applied_at = None
                changed += ["applied_at", "previous_applied_at"]

        if changed and kwargs.get("update_fields") is not None:
            kwargs["update_fields"] = {*kwargs["update_fields"], *changed}
        super().save(*args, **kwargs)
        self._remember_loaded()


class InterviewRound(models.Model):
    class RoundType(models.TextChoices):
        PHONE_SCREEN = "phone_screen", "Phone screen"
        TECHNICAL = "technical", "Technical"
        SYSTEM_DESIGN = "system_design", "System design"
        BEHAVIORAL = "behavioral", "Behavioral"
        HIRING_MANAGER = "hiring_manager", "Hiring manager"
        TAKE_HOME = "take_home", "Take-home"
        ONSITE = "onsite", "Onsite"
        OTHER = "other", "Other"

    class Outcome(models.TextChoices):
        PENDING = "pending", "Pending"
        PASSED = "passed", "Passed"
        FAILED = "failed", "Failed"

    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="rounds")
    round_type = models.CharField(max_length=20, choices=RoundType.choices)
    scheduled_at = models.DateTimeField()
    interviewer = models.CharField(max_length=200, blank=True)
    outcome = models.CharField(max_length=10, choices=Outcome.choices, default=Outcome.PENDING)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["-scheduled_at"]

    def __str__(self):
        return f"{self.get_round_type_display()} - {self.application}"


class Debrief(models.Model):
    """What happened in a round, written by the candidate afterwards."""
    round = models.OneToOneField(InterviewRound, on_delete=models.CASCADE, related_name="debrief")
    # [{question, answer, topic, confidence 1-5}]
    questions = models.JSONField(default=list, blank=True)
    went_well = models.TextField(blank=True)
    went_badly = models.TextField(blank=True)
    interviewer_cues = models.TextField(blank=True)
    recruiter_feedback = models.TextField(blank=True)
    overall_feeling = models.PositiveSmallIntegerField(
        null=True, blank=True, validators=[MinValueValidator(1), MaxValueValidator(5)]
    )
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Debrief for {self.round}"


class RoundAnalysis(models.Model):
    round = models.OneToOneField(InterviewRound, on_delete=models.CASCADE, related_name="analysis")
    status = models.CharField(max_length=10, choices=JobStatus.choices, default=JobStatus.PENDING)
    source = models.CharField(max_length=10, blank=True)  # "ai" or "rules"
    summary = models.TextField(blank=True)
    score = models.PositiveSmallIntegerField(null=True, blank=True)  # 0-100
    strengths = models.JSONField(default=list, blank=True)
    # [{topic, severity: low/medium/high, evidence, advice}]
    weaknesses = models.JSONField(default=list, blank=True)
    # [{question, verdict, better_answer}]
    answer_reviews = models.JSONField(default=list, blank=True)
    error = models.TextField(blank=True)
    # The debrief changed after this analysis ran, and no new one could be started (daily limit).
    stale = models.BooleanField(default=False)
    # This (failed) analysis was given back and didn't count towards the user's limit.
    refunded = models.BooleanField(default=False)
    # The run this analysis counts against. A job only writes here while this is still its run.
    run = models.ForeignKey("AnalysisRun", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # When the current job actually started running (not when it was queued).
    started_at = models.DateTimeField(null=True, blank=True)
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Analysis for {self.round}"


class AnalysisRun(models.Model):
    """
    One paid AI job started for a user: a round analysis or a prep plan.
    Counts against their plan's limit for that kind unless refunded.
    """

    class Kind(models.TextChoices):
        ANALYSIS = "analysis", "Round analysis"
        PREP_PLAN = "prep_plan", "Prep plan"

    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="analysis_runs")
    kind = models.CharField(max_length=10, choices=Kind.choices, default=Kind.ANALYSIS)
    # Kept when the round or plan is deleted, so deleting it doesn't give the run back.
    round = models.ForeignKey(InterviewRound, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    prep_plan = models.ForeignKey("PrepPlan", on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)
    # Given back: the job failed for a reason that wasn't the user's.
    refunded = models.BooleanField(default=False)
    # The refunded attempt had reached the paid API, so it cost us (these refunds are capped).
    billed = models.BooleanField(default=False)
    # Ran with no API key (free rule-based analyzer/planner), so it never counts against a limit.
    free = models.BooleanField(default=False)

    class Meta:
        ordering = ["-created_at"]
        indexes = [models.Index(fields=["user", "kind", "created_at"])]

    def __str__(self):
        return f"{self.get_kind_display()} by {self.user} at {self.created_at:%Y-%m-%d %H:%M}"


class PrepPlan(models.Model):
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="prep_plans")
    application = models.ForeignKey(Application, on_delete=models.CASCADE, related_name="prep_plans")
    target_round = models.ForeignKey(
        InterviewRound, on_delete=models.SET_NULL, null=True, blank=True, related_name="prep_plans"
    )
    interview_date = models.DateField()
    status = models.CharField(max_length=10, choices=JobStatus.choices, default=JobStatus.PENDING)
    source = models.CharField(max_length=10, blank=True)
    summary = models.TextField(blank=True)
    error = models.TextField(blank=True)
    # The run this generation counts against. A job only writes here while this is still its run.
    run = models.ForeignKey(AnalysisRun, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    # When the current job actually started running (not when it was queued).
    started_at = models.DateTimeField(null=True, blank=True)
    # This (failed) generation was given back and didn't count towards the user's limit.
    refunded = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["interview_date", "-created_at"]

    def __str__(self):
        return f"Prep plan for {self.application} on {self.interview_date}"


class PrepTask(models.Model):
    plan = models.ForeignKey(PrepPlan, on_delete=models.CASCADE, related_name="tasks")
    date = models.DateField()
    topic = models.CharField(max_length=200)
    title = models.CharField(max_length=300)
    detail = models.TextField(blank=True)
    minutes = models.PositiveSmallIntegerField(default=30)
    done = models.BooleanField(default=False)

    class Meta:
        ordering = ["date", "id"]

    def __str__(self):
        return self.title
