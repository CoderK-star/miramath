from pathlib import Path
from typing import Any, cast

import chromadb
import fitz  # PyMuPDF

from app.config import CHROMA_PERSIST_DIR
from app.services.ai_service import extract_text_from_image

_client: Any | None = None


def _get_chroma_client() -> Any:
    global _client
    if _client is None:
        _client = chromadb.PersistentClient(path=CHROMA_PERSIST_DIR)
    return _client


def _get_collection() -> chromadb.Collection:
    client = _get_chroma_client()
    return client.get_or_create_collection(
        name="math_materials",
        metadata={"hnsw:space": "cosine"},
    )


def _chunk_text(text: str, chunk_size: int = 500, overlap: int = 100) -> list[str]:
    """テキストを指定サイズでチャンクに分割する。"""
    if not text.strip():
        return []
    chunks = []
    start = 0
    while start < len(text):
        end = start + chunk_size
        chunk = text[start:end]
        if chunk.strip():
            chunks.append(chunk.strip())
        start += chunk_size - overlap
    return chunks


def extract_text_from_pdf(pdf_path: str) -> str:
    """PDFからテキストを抽出する。"""
    doc = fitz.open(pdf_path)
    text_parts = []
    for page in doc:
        text_parts.append(cast(Any, page).get_text())
    doc.close()
    return "\n".join(text_parts)


async def index_material(
    material_id: int,
    file_path: str,
    file_type: str,
) -> int:
    """資料をベクトル化してChromaDBに格納する。チャンク数を返す。"""
    if file_type == "pdf":
        text = extract_text_from_pdf(file_path)
    elif file_type == "image":
        text = await extract_text_from_image(file_path)
    else:
        raise ValueError(f"Unsupported file type: {file_type}")

    chunks = _chunk_text(text)
    if not chunks:
        return 0

    collection = _get_collection()

    ids = [f"mat_{material_id}_chunk_{i}" for i in range(len(chunks))]
    metadatas: list[dict[str, str | int]] = [
        {"material_id": material_id, "chunk_index": i, "file_type": file_type}
        for i in range(len(chunks))
    ]

    collection.add(documents=chunks, ids=ids, metadatas=cast(Any, metadatas))

    return len(chunks)


def search_materials(query: str, n_results: int = 5) -> list[dict]:
    """クエリに関連する資料チャンクを検索する。"""
    collection = _get_collection()
    if collection.count() == 0:
        return []

    raw = cast(Any, collection.query(query_texts=[query], n_results=n_results))
    documents: list[list[str]] = raw.get("documents") or []
    metadatas: list[list[dict]] = raw.get("metadatas") or []
    distances: list[list[float]] = raw.get("distances") or []

    if not documents or not documents[0]:
        return []

    docs = []
    for i, doc in enumerate(documents[0]):
        metadata = metadatas[0][i] if metadatas and metadatas[0] else {}
        distance = distances[0][i] if distances and distances[0] else None
        docs.append(
            {
                "content": doc,
                "metadata": metadata,
                "distance": distance,
            }
        )
    return docs


def delete_material_chunks(material_id: int) -> None:
    """指定資料のチャンクをChromaDBから削除する。"""
    collection = _get_collection()
    collection.delete(where={"material_id": material_id})
