from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_session
from app.models.curriculum import CurriculumUnit
from app.services.curriculum_service import (
    generate_curriculum,
    get_curriculum,
    update_topic_status,
)

router = APIRouter(prefix="/api/curriculum", tags=["curriculum"], dependencies=[Depends(require_session)])


class TopicOut(BaseModel):
    id: int
    title: str
    description: str
    status: str
    order: int

    model_config = {"from_attributes": True}


class SectionOut(BaseModel):
    id: int
    title: str
    description: str
    order: int
    topics: list[TopicOut]

    model_config = {"from_attributes": True}


class UnitOut(BaseModel):
    id: int
    title: str
    description: str
    order: int
    sections: list[SectionOut]

    model_config = {"from_attributes": True}


class StatusUpdate(BaseModel):
    status: str


def _unit_to_out(unit: CurriculumUnit) -> UnitOut:
    return UnitOut(
        id=unit.id,
        title=unit.title,
        description=unit.description,
        order=unit.order,
        sections=[
            SectionOut(
                id=s.id,
                title=s.title,
                description=s.description,
                order=s.order,
                topics=[
                    TopicOut(
                        id=t.id,
                        title=t.title,
                        description=t.description,
                        status=t.status,
                        order=t.order,
                    )
                    for t in sorted(s.topics, key=lambda x: x.order)
                ],
            )
            for s in sorted(unit.sections, key=lambda x: x.order)
        ],
    )


@router.get("", response_model=list[UnitOut])
def get_curriculum_endpoint(db: Session = Depends(get_db)):
    units = get_curriculum(db)
    return [_unit_to_out(u) for u in units]


@router.post("/generate", response_model=list[UnitOut])
async def generate_curriculum_endpoint(db: Session = Depends(get_db)):
    units = await generate_curriculum(db)
    return [_unit_to_out(u) for u in units]


@router.patch("/topics/{topic_id}", response_model=TopicOut)
def update_topic_endpoint(
    topic_id: int, body: StatusUpdate, db: Session = Depends(get_db)
):
    try:
        topic = update_topic_status(db, topic_id, body.status)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    return TopicOut(
        id=topic.id,
        title=topic.title,
        description=topic.description,
        status=topic.status,
        order=topic.order,
    )
