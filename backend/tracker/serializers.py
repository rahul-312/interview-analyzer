from rest_framework import serializers

from .models import Application, Debrief, InterviewRound, PrepPlan, PrepTask, RoundAnalysis


class ApplicationSerializer(serializers.ModelSerializer):
    rounds_count = serializers.IntegerField(source="rounds.count", read_only=True)
    status_label = serializers.CharField(source="get_status_display", read_only=True)

    class Meta:
        model = Application
        exclude = ["user"]
        read_only_fields = ["created_at", "updated_at"]


class DebriefQuestionSerializer(serializers.Serializer):
    question = serializers.CharField()
    answer = serializers.CharField(allow_blank=True, required=False, default="")
    topic = serializers.CharField(allow_blank=True, required=False, default="")
    confidence = serializers.IntegerField(min_value=1, max_value=5, allow_null=True, required=False, default=None)


class DebriefSerializer(serializers.ModelSerializer):
    questions = DebriefQuestionSerializer(many=True, required=False)

    class Meta:
        model = Debrief
        exclude = ["id", "round"]
        read_only_fields = ["updated_at"]


class RoundAnalysisSerializer(serializers.ModelSerializer):
    class Meta:
        model = RoundAnalysis
        exclude = ["id", "round", "run"]
        read_only_fields = [f.name for f in RoundAnalysis._meta.fields]


def advance_status(rnd):
    """Logging a round moves the application forward so the funnel stays accurate."""
    app = rnd.application
    is_screen = rnd.round_type == InterviewRound.RoundType.PHONE_SCREEN
    if app.status == Application.Status.APPLIED:
        app.status = Application.Status.SCREENING if is_screen else Application.Status.INTERVIEW
    elif app.status == Application.Status.SCREENING and not is_screen:
        app.status = Application.Status.INTERVIEW
    else:
        return
    app.save(update_fields=["status", "updated_at"])


class InterviewRoundSerializer(serializers.ModelSerializer):
    debrief = DebriefSerializer(required=False, allow_null=True)
    analysis = RoundAnalysisSerializer(read_only=True)
    company = serializers.CharField(source="application.company", read_only=True)
    role = serializers.CharField(source="application.role", read_only=True)
    round_type_label = serializers.CharField(source="get_round_type_display", read_only=True)

    class Meta:
        model = InterviewRound
        fields = [
            "id", "application", "company", "role", "round_type", "round_type_label",
            "scheduled_at", "interviewer", "outcome", "debrief", "analysis", "created_at",
        ]
        read_only_fields = ["created_at"]

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.debrief_saved = False

    def validate_application(self, application):
        if application.user_id != self.context["request"].user.id:
            raise serializers.ValidationError("Application not found.")
        return application

    def _save_debrief(self, rnd, debrief_data):
        if debrief_data is None:
            return
        existing = Debrief.objects.filter(round=rnd).first()
        # Only a changed debrief needs a new analysis (the edit form re-sends it on every save).
        if existing and all(getattr(existing, field) == value for field, value in debrief_data.items()):
            return
        Debrief.objects.update_or_create(round=rnd, defaults=debrief_data)
        self.debrief_saved = True

    def create(self, validated_data):
        debrief_data = validated_data.pop("debrief", None)
        rnd = InterviewRound.objects.create(**validated_data)
        self._save_debrief(rnd, debrief_data)
        advance_status(rnd)
        return rnd

    def update(self, instance, validated_data):
        debrief_data = validated_data.pop("debrief", None)
        rnd = super().update(instance, validated_data)
        self._save_debrief(rnd, debrief_data)
        return rnd


class PrepTaskSerializer(serializers.ModelSerializer):
    class Meta:
        model = PrepTask
        fields = ["id", "date", "topic", "title", "detail", "minutes", "done"]
        read_only_fields = ["id", "date", "topic", "title", "detail", "minutes"]


class PrepPlanSerializer(serializers.ModelSerializer):
    tasks = PrepTaskSerializer(many=True, read_only=True)
    company = serializers.CharField(source="application.company", read_only=True)
    role = serializers.CharField(source="application.role", read_only=True)
    target_round_label = serializers.CharField(
        source="target_round.get_round_type_display", read_only=True, default=None
    )
    interview_date = serializers.DateField(required=False)

    class Meta:
        model = PrepPlan
        fields = [
            "id", "application", "company", "role", "target_round", "target_round_label",
            "interview_date", "status", "source", "summary", "error", "tasks", "created_at",
        ]
        read_only_fields = ["status", "source", "summary", "error", "created_at"]

    def validate(self, attrs):
        user = self.context["request"].user
        application = attrs.get("application")
        target_round = attrs.get("target_round")

        if application and application.user_id != user.id:
            raise serializers.ValidationError({"application": "Application not found."})
        if target_round:
            if target_round.application.user_id != user.id:
                raise serializers.ValidationError({"target_round": "Round not found."})
            if application and target_round.application_id != application.id:
                raise serializers.ValidationError({"target_round": "That round belongs to a different application."})
            attrs.setdefault("interview_date", target_round.scheduled_at.date())

        if not attrs.get("interview_date"):
            raise serializers.ValidationError(
                {"interview_date": "Pick an upcoming round or enter the interview date."}
            )
        return attrs
