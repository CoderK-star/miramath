from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

from app.database import get_db
from app.dependencies import require_session
from app.models.note import Note

router = APIRouter(prefix="/api/notes", tags=["notes"], dependencies=[Depends(require_session)])


class NoteCreateRequest(BaseModel):
    title: str
    category: str
    image_data: str

    @field_validator("title", "category", "image_data")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("必須項目です")
        return normalized


class NoteUpdateRequest(BaseModel):
    title: str
    category: str
    image_data: str

    @field_validator("title", "category", "image_data")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("必須項目です")
        return normalized


class NoteOut(BaseModel):
    id: int
    title: str
    category: str
    image_data: str
    created_at: str
    updated_at: str


def _to_note_out(note: Note) -> NoteOut:
    return NoteOut(
        id=note.id,
        title=note.title,
        category=note.category,
        image_data=note.image_data,
        created_at=note.created_at.isoformat(),
        updated_at=note.updated_at.isoformat(),
    )


@router.get("", response_model=list[NoteOut])
def list_notes(db: Session = Depends(get_db)):
    notes = db.query(Note).order_by(Note.updated_at.desc()).all()
    return [_to_note_out(note) for note in notes]


@router.post("", response_model=NoteOut)
def create_note(body: NoteCreateRequest, db: Session = Depends(get_db)):
    note = Note(
        title=body.title,
        category=body.category,
        image_data=body.image_data,
    )
    db.add(note)
    db.commit()
    db.refresh(note)
    return _to_note_out(note)


@router.patch("/{note_id}", response_model=NoteOut)
def update_note(note_id: int, body: NoteUpdateRequest, db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="メモが見つかりません")

    note.title = body.title
    note.category = body.category
    note.image_data = body.image_data
    db.commit()
    db.refresh(note)
    return _to_note_out(note)


@router.delete("/{note_id}")
def delete_note(note_id: int, db: Session = Depends(get_db)):
    note = db.query(Note).filter(Note.id == note_id).first()
    if not note:
        raise HTTPException(status_code=404, detail="メモが見つかりません")

    db.delete(note)
    db.commit()
    return {"ok": True}