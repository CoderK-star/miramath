import json
from pathlib import Path
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, UploadFile
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR
from app.database import get_db
from app.dependencies import require_session
from app.models.chat import Conversation, Message
from app.models.material import Material
from app.services.ai_service import chat_stream
from app.services.rag_service import search_materials

router = APIRouter(prefix="/api/chat", tags=["chat"], dependencies=[Depends(require_session)])


def _build_reference_line(material_name: str, content: str, chunk_index: int | None) -> str:
    excerpt = " ".join(content.split())
    if len(excerpt) > 140:
        excerpt = f"{excerpt[:140]}..."
    if chunk_index is not None:
        return f"- {material_name}（該当箇所: chunk {chunk_index}）: {excerpt}"
    return f"- {material_name}: {excerpt}"


def _build_rag_reference_section(
    rag_results: list[dict],
    material_name_map: dict[int, str],
) -> str:
    if not rag_results:
        return "\n\n---\n### 参照資料\nなし"

    lines: list[str] = []
    for row in rag_results:
        metadata = row.get("metadata") if isinstance(row, dict) else None
        content = row.get("content", "") if isinstance(row, dict) else ""
        if not isinstance(content, str) or not content.strip():
            continue

        material_id = metadata.get("material_id") if isinstance(metadata, dict) else None
        chunk_index = metadata.get("chunk_index") if isinstance(metadata, dict) else None

        name = "不明な資料"
        if isinstance(material_id, int):
            name = material_name_map.get(material_id, f"資料#{material_id}")
        if not isinstance(chunk_index, int):
            chunk_index = None

        lines.append(_build_reference_line(name, content, chunk_index))

    if not lines:
        return "\n\n---\n### 参照資料\nなし"

    return "\n\n---\n### 参照資料\n" + "\n".join(lines)


class ChatRequest(BaseModel):
    message: str
    conversation_id: int | None = None


class ConversationOut(BaseModel):
    id: int
    title: str
    created_at: str
    updated_at: str

    model_config = {"from_attributes": True}


class MessageOut(BaseModel):
    id: int
    role: str
    content: str
    image_path: str | None
    created_at: str

    model_config = {"from_attributes": True}


@router.get("/conversations", response_model=list[ConversationOut])
def list_conversations(db: Session = Depends(get_db)):
    convs = db.query(Conversation).order_by(Conversation.updated_at.desc()).all()
    return [
        ConversationOut(
            id=c.id,
            title=c.title,
            created_at=c.created_at.isoformat(),
            updated_at=c.updated_at.isoformat(),
        )
        for c in convs
    ]


@router.get("/conversations/{conversation_id}/messages", response_model=list[MessageOut])
def get_messages(conversation_id: int, db: Session = Depends(get_db)):
    msgs = (
        db.query(Message)
        .filter(Message.conversation_id == conversation_id)
        .order_by(Message.created_at)
        .all()
    )
    return [
        MessageOut(
            id=m.id,
            role=m.role,
            content=m.content,
            image_path=m.image_path,
            created_at=m.created_at.isoformat(),
        )
        for m in msgs
    ]


@router.post("/conversations", response_model=ConversationOut)
def create_conversation(db: Session = Depends(get_db)):
    conv = Conversation()
    db.add(conv)
    db.commit()
    db.refresh(conv)
    return ConversationOut(
        id=conv.id,
        title=conv.title,
        created_at=conv.created_at.isoformat(),
        updated_at=conv.updated_at.isoformat(),
    )


@router.delete("/conversations/{conversation_id}")
def delete_conversation(conversation_id: int, db: Session = Depends(get_db)):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if conv:
        db.delete(conv)
        db.commit()
    return {"ok": True}


@router.post("/send")
async def send_message(
    message: str = Form(...),
    conversation_id: int = Form(...),
    image: UploadFile | None = File(None),
    db: Session = Depends(get_db),
):
    conv = db.query(Conversation).filter(Conversation.id == conversation_id).first()
    if not conv:
        conv = Conversation(id=conversation_id)
        db.add(conv)
        db.commit()
        db.refresh(conv)

    # 画像の保存
    image_path = None
    if image and image.filename:
        ext = Path(image.filename).suffix
        saved_name = f"{uuid4().hex}{ext}"
        save_path = UPLOAD_DIR / saved_name
        content = await image.read()
        save_path.write_bytes(content)
        image_path = str(save_path)

    # ユーザーメッセージをDB保存
    user_msg = Message(
        conversation_id=conv.id,
        role="user",
        content=message,
        image_path=image_path,
    )
    db.add(user_msg)
    db.commit()

    # 会話タイトルの自動設定（最初のメッセージ）
    msg_count = (
        db.query(Message).filter(Message.conversation_id == conv.id).count()
    )
    if msg_count == 1:
        conv.title = message[:50]
        db.commit()

    # 過去のメッセージ履歴を取得
    past_messages = (
        db.query(Message)
        .filter(Message.conversation_id == conv.id, Message.id != user_msg.id)
        .order_by(Message.created_at)
        .all()
    )
    history = [{"role": m.role, "content": m.content} for m in past_messages]

    # RAGコンテキスト追加
    rag_results = search_materials(message, n_results=3)
    material_ids = {
        row.get("metadata", {}).get("material_id")
        for row in rag_results
        if isinstance(row, dict)
        and isinstance(row.get("metadata"), dict)
        and isinstance(row.get("metadata", {}).get("material_id"), int)
    }
    material_name_map: dict[int, str] = {}
    if material_ids:
        mats = (
            db.query(Material)
            .filter(Material.id.in_(material_ids))
            .all()
        )
        material_name_map = {m.id: m.original_filename for m in mats}

    rag_reference_section = _build_rag_reference_section(
        rag_results,
        material_name_map,
    )

    augmented_message = message
    if rag_results:
        context = "\n\n".join(
            f"【参考資料】\n{r['content']}" for r in rag_results
        )
        augmented_message = f"{context}\n\n---\n\n生徒の質問: {message}"

    # ストリーミングレスポンス
    async def event_stream():
        full_response = []
        try:
            async for chunk in chat_stream(augmented_message, history, image_path):
                full_response.append(chunk)
                data = json.dumps({"type": "chunk", "content": chunk}, ensure_ascii=False)
                yield f"data: {data}\n\n"

            full_response.append(rag_reference_section)
            reference_data = json.dumps(
                {"type": "chunk", "content": rag_reference_section},
                ensure_ascii=False,
            )
            yield f"data: {reference_data}\n\n"

            # アシスタントメッセージをDB保存
            assistant_content = "".join(full_response)
            assistant_msg = Message(
                conversation_id=conv.id,
                role="assistant",
                content=assistant_content,
            )
            db.add(assistant_msg)
            db.commit()

            yield f"data: {json.dumps({'type': 'done'})}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'content': str(e)}, ensure_ascii=False)}\n\n"

    return StreamingResponse(event_stream(), media_type="text/event-stream")
