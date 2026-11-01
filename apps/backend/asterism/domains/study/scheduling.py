"""Spaced-repetition scheduling behind a small, pure interface (ADR-0033).

``FsrsScheduler`` implements FSRS-6 (the Free Spaced Repetition Scheduler) with
its published default parameters, a desired retention of 0.9, and the reference
implementation's default learning steps (1 and 10 minutes) and relearning step
(10 minutes). Interval fuzzing is off, so results are deterministic. Nothing
here touches a session or a clock: callers pass ``now``.
"""

import math
from dataclasses import dataclass, replace
from datetime import UTC, datetime, timedelta
from enum import IntEnum, StrEnum
from typing import Protocol

# FSRS-6 default parameters w[0]..w[20].
FSRS6_DEFAULT_PARAMETERS: tuple[float, ...] = (
    0.212,
    1.2931,
    2.3065,
    8.2956,
    6.4133,
    0.8334,
    3.0194,
    0.001,
    1.8722,
    0.1666,
    0.796,
    1.4835,
    0.0614,
    0.2629,
    1.6483,
    0.6014,
    1.8729,
    0.5425,
    0.0912,
    0.0658,
    0.1542,
)
STABILITY_MIN = 0.001
DIFFICULTY_MIN = 1.0
DIFFICULTY_MAX = 10.0


class Rating(IntEnum):
    AGAIN = 1
    HARD = 2
    GOOD = 3
    EASY = 4


class CardState(StrEnum):
    LEARNING = "learning"
    REVIEW = "review"
    RELEARNING = "relearning"


@dataclass(frozen=True)
class ScheduleState:
    """A card's memory state. A new card is learning at step 0 with no stability yet."""

    state: CardState = CardState.LEARNING
    step: int | None = 0
    stability: float | None = None
    difficulty: float | None = None
    due_at: datetime | None = None
    last_reviewed_at: datetime | None = None


class Scheduler(Protocol):
    def schedule(self, state: ScheduleState, rating: Rating, now: datetime) -> ScheduleState:
        """The state after rating a card at ``now``; ``due_at`` is the next review time."""
        ...


def _clamp(value: float, low: float, high: float) -> float:
    return min(max(value, low), high)


class FsrsScheduler:
    def __init__(
        self,
        *,
        parameters: tuple[float, ...] = FSRS6_DEFAULT_PARAMETERS,
        desired_retention: float = 0.9,
        learning_steps: tuple[timedelta, ...] = (timedelta(minutes=1), timedelta(minutes=10)),
        relearning_steps: tuple[timedelta, ...] = (timedelta(minutes=10),),
        maximum_interval_days: int = 36_500,
    ) -> None:
        if len(parameters) != 21:
            raise ValueError("FSRS-6 needs 21 parameters")
        if not 0 < desired_retention < 1:
            raise ValueError("Desired retention must be between 0 and 1")
        self.w = parameters
        self.desired_retention = desired_retention
        self.learning_steps = learning_steps
        self.relearning_steps = relearning_steps
        self.maximum_interval_days = maximum_interval_days
        self.decay = -parameters[20]
        # Chosen so that retrievability is exactly 0.9 after ``stability`` days.
        self.factor = 0.9 ** (1 / self.decay) - 1

    # --- Model equations ---------------------------------------------------

    def retrievability(self, stability: float, elapsed_days: float) -> float:
        return (1 + self.factor * max(0.0, elapsed_days) / stability) ** self.decay

    def initial_stability(self, rating: Rating) -> float:
        return max(self.w[rating - 1], STABILITY_MIN)

    def initial_difficulty(self, rating: Rating, *, clamp: bool = True) -> float:
        value = self.w[4] - math.exp(self.w[5] * (rating - 1)) + 1
        return _clamp(value, DIFFICULTY_MIN, DIFFICULTY_MAX) if clamp else value

    def next_interval_days(self, stability: float) -> int:
        days = (stability / self.factor) * (self.desired_retention ** (1 / self.decay) - 1)
        return int(_clamp(round(days), 1, self.maximum_interval_days))

    def next_difficulty(self, difficulty: float, rating: Rating) -> float:
        delta = -self.w[6] * (rating - 3)
        damped = difficulty + delta * (10 - difficulty) / 9
        reverted = self.w[7] * self.initial_difficulty(Rating.EASY, clamp=False) + (1 - self.w[7]) * damped
        return _clamp(reverted, DIFFICULTY_MIN, DIFFICULTY_MAX)

    def short_term_stability(self, stability: float, rating: Rating) -> float:
        increase = math.exp(self.w[17] * (rating - 3 + self.w[18])) * stability ** -self.w[19]
        if rating >= Rating.GOOD:
            increase = max(increase, 1.0)
        return max(stability * increase, STABILITY_MIN)

    def recall_stability(self, difficulty: float, stability: float, retrievability: float, rating: Rating) -> float:
        hard_penalty = self.w[15] if rating == Rating.HARD else 1.0
        easy_bonus = self.w[16] if rating == Rating.EASY else 1.0
        growth = (
            math.exp(self.w[8])
            * (11 - difficulty)
            * stability ** -self.w[9]
            * (math.exp((1 - retrievability) * self.w[10]) - 1)
        )
        return max(stability * (1 + growth * hard_penalty * easy_bonus), STABILITY_MIN)

    def forget_stability(self, difficulty: float, stability: float, retrievability: float) -> float:
        long_term = (
            self.w[11]
            * difficulty ** -self.w[12]
            * ((stability + 1) ** self.w[13] - 1)
            * math.exp((1 - retrievability) * self.w[14])
        )
        short_term = stability / math.exp(self.w[17] * self.w[18])
        return max(min(long_term, short_term), STABILITY_MIN)

    # --- Transitions -------------------------------------------------------

    def _memory(self, state: ScheduleState, rating: Rating, now: datetime) -> tuple[float, float]:
        if state.stability is None or state.difficulty is None:
            return self.initial_stability(rating), self.initial_difficulty(rating)
        elapsed = (now - state.last_reviewed_at).total_seconds() / 86_400 if state.last_reviewed_at else 0.0
        if elapsed < 1:
            stability = self.short_term_stability(state.stability, rating)
        elif rating == Rating.AGAIN:
            retrievability = self.retrievability(state.stability, math.floor(elapsed))
            stability = self.forget_stability(state.difficulty, state.stability, retrievability)
        else:
            retrievability = self.retrievability(state.stability, math.floor(elapsed))
            stability = self.recall_stability(state.difficulty, state.stability, retrievability, rating)
        return stability, self.next_difficulty(state.difficulty, rating)

    def _stepped(
        self, steps: tuple[timedelta, ...], step: int, stability: float, rating: Rating
    ) -> tuple[CardState | None, int | None, timedelta]:
        """Learning/relearning step logic; ``None`` state means graduate to review."""
        graduate = (None, None, timedelta(days=self.next_interval_days(stability)))
        if not steps or (step >= len(steps) and rating != Rating.AGAIN):
            return graduate
        if rating == Rating.AGAIN:
            return CardState.LEARNING, 0, steps[0]
        if rating == Rating.HARD:
            if step == 0 and len(steps) == 1:
                return CardState.LEARNING, step, steps[0] * 1.5
            if step == 0:
                return CardState.LEARNING, step, (steps[0] + steps[1]) / 2
            return CardState.LEARNING, step, steps[min(step, len(steps) - 1)]
        if rating == Rating.GOOD:
            if step + 1 >= len(steps):
                return graduate
            return CardState.LEARNING, step + 1, steps[step + 1]
        return graduate

    def schedule(self, state: ScheduleState, rating: Rating, now: datetime) -> ScheduleState:
        now = now.astimezone(UTC)
        stability, difficulty = self._memory(state, rating, now)
        if state.state == CardState.REVIEW:
            if rating == Rating.AGAIN and self.relearning_steps:
                next_state, step, interval = CardState.RELEARNING, 0, self.relearning_steps[0]
            else:
                next_state, step = CardState.REVIEW, None
                interval = timedelta(days=self.next_interval_days(stability))
        else:
            steps = self.learning_steps if state.state == CardState.LEARNING else self.relearning_steps
            stepped_state, step, interval = self._stepped(steps, state.step or 0, stability, rating)
            if stepped_state is None:
                next_state = CardState.REVIEW
            else:
                next_state = state.state  # Learning stays learning; relearning stays relearning.
        return replace(
            state,
            state=next_state,
            step=step,
            stability=stability,
            difficulty=difficulty,
            due_at=now + interval,
            last_reviewed_at=now,
        )


DEFAULT_SCHEDULER: Scheduler = FsrsScheduler()
