from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import ALLOWED_UPLOAD_MIME_TYPES, MAX_UPLOAD_SIZE_MB
from app.database import get_db
from app.dependencies import require_session
from app.models.material import Material
from app.services import storage_service
from app.services.rag_service import delete_material_chunks, index_material

router = APIRouter(prefix="/api/materials", tags=["materials"], dependencies=[Depends(require_session)])

ALLOWED_EXTENSIONS = {".pdf", ".png", ".jpg", ".jpeg", ".webp", ".gif"}


class MaterialOut(BaseModel):
    id: int
    original_filename: str
    file_type: str
    file_size: int
    chunk_count: int
    status: str
    error_message: str | None
    created_at: str

    model_config = {"from_attributes": True}


@router.get("", response_model=list[MaterialOut])
def list_materials(db: Session = Depends(get_db)):
    mats = db.query(Material).order_by(Material.created_at.desc()).all()
    return [
        MaterialOut(
            id=m.id,
            original_filename=m.original_filename,
            file_type=m.file_type,
            file_size=m.file_size,
            chunk_count=m.chunk_count,
            status=m.status,
            error_message=m.error_message,
            created_at=m.created_at.isoformat(),
        )
        for m in mats
    ]


@router.post("/upload", response_model=MaterialOut)
async def upload_material(
    file: UploadFile = File(...),
    db: Session = Depends(get_db),
):
    if not file.filename:
        raise HTTPException(status_code=400, detail="ファイル名が必要です")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"サポートされていないファイル形式です: {ext}",
        )

    if file.content_type and file.content_type not in ALLOWED_UPLOAD_MIME_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "サポートされていないMIMEタイプです: "
                f"{file.content_type}"
            ),
        )

    file_type = "pdf" if ext == ".pdf" else "image"

    content = await file.read()
    max_size_bytes = MAX_UPLOAD_SIZE_MB * 1024 * 1024
    if len(content) > max_size_bytes:
        raise HTTPException(
            status_code=413,
            detail=(
                f"ファイルサイズ上限を超えています: {MAX_UPLOAD_SIZE_MB}MB まで"
            ),
        )

    # ストレージ保存（local または GCS）
    saved_name = f"{uuid4().hex}{ext}"
    blob_path = f"materials/{saved_name}"
    storage_service.upload_file(content, blob_path)

    # DB登録
    material = Material(
        filename=blob_path,
        original_filename=file.filename,
        file_type=file_type,
        file_size=len(content),
    )
    db.add(material)
    db.commit()
    db.refresh(material)

    # ベクトル化（バイト列を直接渡す）
    try:
        chunk_count = await index_material(material.id, content, file_type, db)
        material.chunk_count = chunk_count
        material.status = "ready"
    except Exception as e:
        material.status = "error"
        material.error_message = str(e)
    db.commit()
    db.refresh(material)

    return MaterialOut(
        id=material.id,
        original_filename=material.original_filename,
        file_type=material.file_type,
        file_size=material.file_size,
        chunk_count=material.chunk_count,
        status=material.status,
        error_message=material.error_message,
        created_at=material.created_at.isoformat(),
    )


@router.delete("/{material_id}")
def delete_material(material_id: int, db: Session = Depends(get_db)):
    material = db.query(Material).filter(Material.id == material_id).first()
    if not material:
        raise HTTPException(status_code=404, detail="資料が見つかりません")

    # ストレージからファイル削除
    storage_service.delete_file(material.filename)

    # チャンク削除
    delete_material_chunks(material_id, db)

    # DB削除
    db.delete(material)
    db.commit()
    return {"ok": True}
