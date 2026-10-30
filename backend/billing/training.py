"""
The only way a training or evaluation pipeline may select debriefs.

A debrief is usable only if (1) every version of it was written on a plan whose debriefs may be
used for training (Debrief.training_eligible), and (2) its author is on such a plan now. So:
- upgrading to a paid plan excludes all of a user's debriefs from then on, including ones
  written on Free (anything already used before the upgrade can't be taken back);
- downgrading to Free doesn't make debriefs written on a paid plan eligible, only new ones.
"""
from tracker.models import Debrief

from . import entitlements, tiers


def training_eligible_debriefs(now=None):
    """
    One query: the author's complimentary plan may train, and no subscription gives them a paid
    plan right now. This is entitlements.tier_for, worked out for every author at once.
    """
    may_train = [code for code in tiers.RANK if tiers.get_tier(code).debriefs_may_train]
    return (
        Debrief.objects.filter(training_eligible=True, round__application__user__profile__plan__in=may_train)
        .exclude(round__application__user_id__in=entitlements.paid_user_ids(now))
    )
