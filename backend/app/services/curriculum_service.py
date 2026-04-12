import json

from sqlalchemy.orm import Session

from app.models.curriculum import CurriculumSection, CurriculumTopic, CurriculumUnit
from app.services.ai_service import generate_curriculum_with_ai


def _parse_curriculum_json(raw: str) -> dict:
    """AIの出力からJSONを抽出してパースする。"""
    text = raw.strip()
    # ```json ... ``` のコードブロックから抽出
    if "```json" in text:
        text = text.split("```json", 1)[1]
        text = text.split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1]
        text = text.split("```", 1)[0]
    return json.loads(text.strip())


async def generate_curriculum(db: Session) -> list[CurriculumUnit]:
    """AIでカリキュラムを生成してDBに保存する。"""
    # 既存のカリキュラムを削除
    db.query(CurriculumTopic).delete()
    db.query(CurriculumSection).delete()
    db.query(CurriculumUnit).delete()
    db.commit()

    raw = await generate_curriculum_with_ai()
    data = _parse_curriculum_json(raw)

    units = []
    for u_idx, u_data in enumerate(data["units"]):
        unit = CurriculumUnit(
            title=u_data["title"],
            description=u_data.get("description", ""),
            order=u_idx,
        )
        db.add(unit)
        db.flush()

        for s_idx, s_data in enumerate(u_data.get("sections", [])):
            section = CurriculumSection(
                unit_id=unit.id,
                title=s_data["title"],
                description=s_data.get("description", ""),
                order=s_idx,
            )
            db.add(section)
            db.flush()

            for t_idx, t_data in enumerate(s_data.get("topics", [])):
                topic = CurriculumTopic(
                    section_id=section.id,
                    title=t_data["title"],
                    description=t_data.get("description", ""),
                    order=t_idx,
                )
                db.add(topic)

    db.commit()

    return (
        db.query(CurriculumUnit).order_by(CurriculumUnit.order).all()
    )


def get_curriculum(db: Session) -> list[CurriculumUnit]:
    return db.query(CurriculumUnit).order_by(CurriculumUnit.order).all()


def update_topic_status(db: Session, topic_id: int, status: str) -> CurriculumTopic:
    topic = db.query(CurriculumTopic).filter(CurriculumTopic.id == topic_id).first()
    if not topic:
        raise ValueError(f"Topic {topic_id} not found")
    if status not in ("not_started", "in_progress", "completed"):
        raise ValueError(f"Invalid status: {status}")
    topic.status = status
    db.commit()
    db.refresh(topic)
    return topic
