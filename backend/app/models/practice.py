from datetime import datetime, timezone

from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, JSON, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class PracticeProblem(Base):
    __tablename__ = "practice_problems"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    topic_id: Mapped[int] = mapped_column(Integer, ForeignKey("curriculum_topics.id"))
    question_type: Mapped[str] = mapped_column(String(20))  # free_text | multiple_choice
    difficulty: Mapped[str] = mapped_column(String(20))  # easy | medium | hard
    question_text: Mapped[str] = mapped_column(Text)
    options: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    correct_answer: Mapped[str] = mapped_column(Text)
    solution_text: Mapped[str] = mapped_column(Text, default="")
    schema_data: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    attempts: Mapped[list["PracticeAttempt"]] = relationship(
        back_populates="problem", cascade="all, delete-orphan"
    )


class PracticeAttempt(Base):
    __tablename__ = "practice_attempts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    problem_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("practice_problems.id")
    )
    user_answer: Mapped[str] = mapped_column(Text)
    working_steps: Mapped[str] = mapped_column(Text, default="")
    final_answer: Mapped[str] = mapped_column(Text, default="")
    score: Mapped[int] = mapped_column(Integer, default=0)
    is_correct: Mapped[bool] = mapped_column(Boolean, default=False)
    feedback: Mapped[str] = mapped_column(Text, default="")
    mistake_points: Mapped[list[str] | None] = mapped_column(JSON, nullable=True)
    next_hint: Mapped[str] = mapped_column(Text, default="")
    rubric_scores: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    mistake_summary: Mapped[dict[str, object] | None] = mapped_column(JSON, nullable=True)
    equivalence_note: Mapped[str] = mapped_column(Text, default="")
    submitted_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    problem: Mapped[PracticeProblem] = relationship(back_populates="attempts")