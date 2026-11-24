"""One person's live feature availability (EPIC-96)."""

from pydantic import BaseModel


class FeatureAvailability(BaseModel):
    """Whether an admin lets this person use one feature now, and why not."""

    available: bool
    reason: str = ""


class Availability(BaseModel):
    """The admin's switches for each feature, as they apply to this person.

    These are the admin's decisions only: policies, groups and provider
    readiness. The person's own opt-ins (such as Use memory) stay in user
    settings. Hiding a feature in the interface never replaces the server's own
    checks when the feature is used.
    """

    memory: FeatureAvailability
    canvas: FeatureAvailability
    image_generation: FeatureAvailability
    skills: FeatureAvailability
    chatgpt_plans: FeatureAvailability
    delegation: FeatureAvailability
    # Whether memory is on for anyone, so an educator's class memory switch can
    # mean something. The educator's own group may still be left out.
    course_memory: FeatureAvailability
    # Decks and quizzes from chat (EPIC-98): the admin switch and the person's group.
    study_chat: FeatureAvailability
    # On for any group, so a class's switch for it means something.
    course_study_chat: FeatureAvailability
