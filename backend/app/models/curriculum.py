from datetime import datetime, timezone

from sqlalchemy import DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class CurriculumUnit(Base):
    """大単元（例: 高校数学II）"""

    __tablename__ = "curriculum_units"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    order: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, default=lambda: datetime.now(timezone.utc)
    )

    sections: Mapped[list["CurriculumSection"]] = relationship(
        back_populates="unit", cascade="all, delete-orphan"
    )


class CurriculumSection(Base):
    """小単元（例: 微分積分入門）"""

    __tablename__ = "curriculum_sections"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    unit_id: Mapped[int] = mapped_column(Integer, ForeignKey("curriculum_units.id"))
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    order: Mapped[int] = mapped_column(Integer, default=0)

    unit: Mapped["CurriculumUnit"] = relationship(back_populates="sections")
    topics: Mapped[list["CurriculumTopic"]] = relationship(
        back_populates="section", cascade="all, delete-orphan"
    )


class CurriculumTopic(Base):
    """トピック（例: 導関数の定義）"""

    __tablename__ = "curriculum_topics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    section_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("curriculum_sections.id")
    )
    title: Mapped[str] = mapped_column(String(200))
    description: Mapped[str] = mapped_column(Text, default="")
    status: Mapped[str] = mapped_column(
        String(20), default="not_started"
    )  # not_started, in_progress, completed
    order: Mapped[int] = mapped_column(Integer, default=0)

    section: Mapped["CurriculumSection"] = relationship(back_populates="topics")
