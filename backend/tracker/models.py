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
    applied_at = models.DateField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # Moving a saved job to one of these means it was applied to.
    APPLIED_STATUSES = {Status.APPLIED, Status.SCREENING, Status.INTERVIEW, Status.OFFER}

    class Meta:
        ordering = ["-date_applied", "-created_at"]

    def __str__(self):
        return f"{self.role} at {self.company}"

    def save(self, *args, **kwargs):
        update_fields = kwargs.get("update_fields")
        if self.applied_at is None:
            if self._state.adding:
                # Added directly with a later status (e.g. logging an old rejection): it was applied to.
                if self.status != self.Status.SAVED:
                    self.applied_at = self.date_applied
            elif self.status in self.APPLIED_STATUSES:
                # Saved -> applied: applied today, so the card's date (the date saved) moves to today.
                # If the same edit set the date, that's when they applied.
                before = type(self).objects.filter(pk=self.pk).values("date_applied").first()
                changed = ["applied_at"]
                if before and self.date_applied == before["date_applied"]:
                    self.date_applied = timezone.localdate()
                    changed.append("date_applied")
                self.applied_at = self.date_applied
                if update_fields is not None:
                    kwargs["update_fields"] = {*update_fields, *changed}
        super().save(*args, **kwargs)


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
