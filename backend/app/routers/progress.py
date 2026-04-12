from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_session
from app.models.curriculum import CurriculumTopic
from app.models.progress import StudySession

router = APIRouter(prefix="/api/progress", tags=["progress"], dependencies=[Depends(require_session)])


def _to_iso(dt: datetime | None) -> str | None:
    return dt.isoformat() if dt is not None else None


def _to_iso_required(dt: datetime | None) -> str:
    if dt is None:
        raise ValueError("datetime is required")
    return dt.isoformat()


class ProgressSummary(BaseModel):
    total_topics: int
    completed_topics: int
    in_progress_topics: int
    completion_rate: float
    total_study_minutes: int


class SessionOut(BaseModel):
    id: int
    topic_id: int | None
    topic_title: str
    duration_minutes: int
    started_at: str
    ended_at: str | None
    status: str

    model_config = {"from_attributes": True}


class StartSessionRequest(BaseModel):
    topic_id: int | None = None
    topic_title: str = ""


@router.get("/summary", response_model=ProgressSummary)
def get_progress_summary(db: Session = Depends(get_db)):
    total = db.query(CurriculumTopic).count()
    completed = (
        db.query(CurriculumTopic)
        .filter(CurriculumTopic.status == "completed")
        .count()
    )
    in_progress = (
        db.query(CurriculumTopic)
        .filter(CurriculumTopic.status == "in_progress")
        .count()
    )
    total_minutes = (
        db.query(func.sum(StudySession.duration_minutes)).scalar() or 0
    )
    return ProgressSummary(
        total_topics=total,
        completed_topics=completed,
        in_progress_topics=in_progress,
        completion_rate=completed / total if total > 0 else 0,
        total_study_minutes=total_minutes,
    )


@router.get("/sessions", response_model=list[SessionOut])
def list_sessions(db: Session = Depends(get_db)):
    sessions = (
        db.query(StudySession).order_by(StudySession.started_at.desc()).limit(50).all()
    )
    return [
        SessionOut(
            id=s.id,
            topic_id=s.topic_id,
            topic_title=s.topic_title,
            duration_minutes=s.duration_minutes,
            started_at=_to_iso_required(s.started_at),
            ended_at=_to_iso(s.ended_at),
            status=s.status,
        )
        for s in sessions
    ]


@router.post("/sessions/start", response_model=SessionOut)
def start_session(body: StartSessionRequest, db: Session = Depends(get_db)):
    session = StudySession(
        topic_id=body.topic_id,
        topic_title=body.topic_title,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return SessionOut(
        id=session.id,
        topic_id=session.topic_id,
        topic_title=session.topic_title,
        duration_minutes=session.duration_minutes,
        started_at=_to_iso_required(session.started_at),
        ended_at=None,
        status=session.status,
    )


@router.post("/sessions/{session_id}/end", response_model=SessionOut)
def end_session(session_id: int, db: Session = Depends(get_db)):
    session = db.query(StudySession).filter(StudySession.id == session_id).first()
    if not session:
        raise HTTPException(status_code=404, detail="セッションが見つかりません")

    now = datetime.now(timezone.utc)
    session.ended_at = now
    if session.started_at is None:
        raise HTTPException(status_code=500, detail="開始時刻が不正です")
    diff = now - session.started_at
    session.duration_minutes = int(diff.total_seconds() / 60)
    session.status = "completed"
    db.commit()
    db.refresh(session)
    return SessionOut(
        id=session.id,
        topic_id=session.topic_id,
        topic_title=session.topic_title,
        duration_minutes=session.duration_minutes,
        started_at=_to_iso_required(session.started_at),
        ended_at=_to_iso(session.ended_at),
        status=session.status,
    )
