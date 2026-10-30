"""
The only way a training or evaluation pipeline may select debriefs.

A debrief is usable only if (1) every version of it was written on a plan whose debriefs may be
used for training (Debrief.training_eligible), and (2) its author is on such a plan now. So:
- upgrading to a paid plan excludes all of a user's debriefs from then on, including ones
  written on Free (anything already used before the upgrade can't be taken back);
- downgrading to Free doesn't make debriefs written on a paid plan eligible, only new ones.
"""
from django.contrib.auth import get_user_model

from tracker.models import Debrief

from . import entitlements


def training_eligible_debriefs():
    candidates = Debrief.objects.filter(training_eligible=True)
    user_ids = set(candidates.values_list("round__application__user_id", flat=True))
    users = get_user_model().objects.filter(id__in=user_ids)
    allowed = [u.id for u in users if entitlements.for_user(u).debriefs_may_train]
    return candidates.filter(round__application__user_id__in=allowed)
