"""ストレージサービス: ローカルファイルシステム / Google Cloud Storage の抽象化。

環境変数 STORAGE_BACKEND で切り替える（デフォルト: local）。
"""

from __future__ import annotations

import logging
from pathlib import Path

from app.config import (
    DATA_DIR,
    GCS_BUCKET_NAME,
    GCS_CREDENTIALS_FILE,
    STORAGE_BACKEND,
)

logger = logging.getLogger(__name__)

_LOCAL_UPLOAD_DIR = DATA_DIR / "uploads"
_LOCAL_UPLOAD_DIR.mkdir(parents=True, exist_ok=True)


# ---------------------------------------------------------------------------
# GCS クライアント（遅延初期化）
# ---------------------------------------------------------------------------

_gcs_client = None
_gcs_bucket = None


def _get_gcs_bucket():
    global _gcs_client, _gcs_bucket
    if _gcs_bucket is None:
        from google.cloud import storage  # type: ignore[import]

        kwargs: dict = {}
        if GCS_CREDENTIALS_FILE:
            kwargs["credentials"] = storage.Client.from_service_account_json(
                GCS_CREDENTIALS_FILE
            )._credentials
        _gcs_client = storage.Client(**kwargs)
        if not GCS_BUCKET_NAME:
            raise RuntimeError("GCS_BUCKET_NAME が設定されていません。")
        _gcs_bucket = _gcs_client.bucket(GCS_BUCKET_NAME)
    return _gcs_bucket


# ---------------------------------------------------------------------------
# パブリック API
# ---------------------------------------------------------------------------


def upload_file(content: bytes, blob_path: str) -> str:
    """ストレージにファイルをアップロードし、blob_path を返す。

    blob_path 例: "materials/abc123.pdf"
    """
    if STORAGE_BACKEND == "gcs":
        bucket = _get_gcs_bucket()
        blob = bucket.blob(blob_path)
        blob.upload_from_string(content)
        logger.info("GCS upload: gs://%s/%s", GCS_BUCKET_NAME, blob_path)
    else:
        dest = _LOCAL_UPLOAD_DIR / blob_path
        dest.parent.mkdir(parents=True, exist_ok=True)
        dest.write_bytes(content)
    return blob_path


def download_file(blob_path: str) -> bytes:
    """ストレージからファイル内容を取得する。"""
    if STORAGE_BACKEND == "gcs":
        bucket = _get_gcs_bucket()
        blob = bucket.blob(blob_path)
        return blob.download_as_bytes()
    else:
        path = _LOCAL_UPLOAD_DIR / blob_path
        return path.read_bytes()


def get_local_path(blob_path: str) -> str:
    """ローカルストレージにおけるファイルの絶対パスを返す。"""
    return str(_LOCAL_UPLOAD_DIR / blob_path)


def delete_file(blob_path: str) -> None:
    """ストレージからファイルを削除する（存在しない場合は無視）。"""
    if STORAGE_BACKEND == "gcs":
        bucket = _get_gcs_bucket()
        blob = bucket.blob(blob_path)
        try:
            blob.delete()
        except Exception as exc:
            logger.warning("GCS delete failed for %s: %s", blob_path, exc)
    else:
        path = _LOCAL_UPLOAD_DIR / blob_path
        if path.exists():
            path.unlink()


def file_exists(blob_path: str) -> bool:
    """ファイルの存在確認。"""
    if STORAGE_BACKEND == "gcs":
        bucket = _get_gcs_bucket()
        return bucket.blob(blob_path).exists()
    else:
        return (_LOCAL_UPLOAD_DIR / blob_path).exists()
