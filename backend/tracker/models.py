from django.conf import settings
from django.core.validators import MaxValueValidator, MinValueValidator
from django.db import models


class JobStatus(models.TextChoices):
    """Status of something produced by a background job."""
    PENDING = "pending", "Pending"
    RUNNING = "running", "Running"
    DONE = "done", "Done"
    FAILED = "failed", "Failed"


class Application(models.Model):
    class Status(models.TextChoices):
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
    job_url = models.URLField(blank=True)
    salary = models.CharField(max_length=100, blank=True)
    source = models.CharField(max_length=20, choices=Source.choices, blank=True)
    contact = models.CharField(max_length=200, blank=True)
    notes = models.TextField(blank=True)
    job_description = models.TextField(blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-date_applied", "-created_at"]

    def __str__(self):
        return f"{self.role} at {self.company}"


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
    updated_at = models.DateTimeField(auto_now=True)

    def __str__(self):
        return f"Analysis for {self.round}"


class AnalysisRun(models.Model):
    """One analysis started for a user. Counted against their plan's daily limit."""
    user = models.ForeignKey(settings.AUTH_USER_MODEL, on_delete=models.CASCADE, related_name="analysis_runs")
    # Kept when the round is deleted, so deleting a round doesn't give the analysis back.
    round = models.ForeignKey(InterviewRound, on_delete=models.SET_NULL, null=True, blank=True, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True, db_index=True)

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"Analysis run by {self.user} at {self.created_at:%Y-%m-%d %H:%M}"


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
