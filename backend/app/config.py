import os
from pathlib import Path
from dotenv import load_dotenv

# .envファイルをプロジェクトルートから読み込む
env_path = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(env_path)

def _parse_csv(name: str, default: str) -> list[str]:
    raw = os.getenv(name, default)
    values = [v.strip() for v in raw.split(",") if v.strip()]
    if not values:
        raise RuntimeError(f"{name} must not be empty")
    return values


def _parse_bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None:
        return default
    value = raw.strip().lower()
    if value in {"1", "true", "yes", "on"}:
        return True
    if value in {"0", "false", "no", "off"}:
        return False
    raise RuntimeError(f"{name} must be one of true/false/1/0/yes/no")


def _parse_int(name: str, default: int, minimum: int, maximum: int) -> int:
    raw = os.getenv(name)
    if raw is None:
        return default
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if not (minimum <= value <= maximum):
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


APP_ENV: str = os.getenv("APP_ENV", "local").strip().lower() or "local"
LOCAL_BETA_MODE: bool = _parse_bool("LOCAL_BETA_MODE", True)
GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
GEMINI_MODEL_NAME: str = os.getenv("GEMINI_MODEL_NAME", "gemini-2.5-flash").strip()
GEMINI_EMBEDDING_MODEL: str = os.getenv("GEMINI_EMBEDDING_MODEL", "text-embedding-004").strip()
API_TIMEOUT_SEC: int = _parse_int("API_TIMEOUT_SEC", 30, 5, 300)
API_MAX_RETRIES: int = _parse_int("API_MAX_RETRIES", 2, 0, 5)

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql://postgres:postgres@localhost:5432/math_teacher",
).strip()
FRONTEND_ORIGINS: list[str] = _parse_csv(
    "FRONTEND_ORIGINS",
    "http://localhost:3000,http://127.0.0.1:3000",
)

MAX_UPLOAD_SIZE_MB: int = _parse_int("MAX_UPLOAD_SIZE_MB", 10, 1, 100)
ALLOWED_UPLOAD_MIME_TYPES: list[str] = _parse_csv(
    "ALLOWED_UPLOAD_MIME_TYPES",
    "application/pdf,image/png,image/jpeg,image/webp,image/gif",
)

SESSION_SECRET: str = os.getenv("SESSION_SECRET", "").strip()
ADMIN_PASSWORD_HASH: str = os.getenv("ADMIN_PASSWORD_HASH", "").strip()

# ストレージバックエンド: local | gcs
STORAGE_BACKEND: str = os.getenv("STORAGE_BACKEND", "local").strip().lower()
GCS_BUCKET_NAME: str = os.getenv("GCS_BUCKET_NAME", "").strip()
GCS_CREDENTIALS_FILE: str = os.getenv("GCS_CREDENTIALS_FILE", "").strip()

# プロジェクトルートからの相対パスを絶対パスに変換
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DATA_DIR = PROJECT_ROOT / "data"
DATA_DIR.mkdir(exist_ok=True)

# SQLiteのパスを絶対パスに変換（後方互換: sqlite:///./... 形式の場合のみ）
if DATABASE_URL.startswith("sqlite:///./"):
    db_path = PROJECT_ROOT / DATABASE_URL.replace("sqlite:///./", "")
    db_path.parent.mkdir(parents=True, exist_ok=True)
    DATABASE_URL = f"sqlite:///{db_path}"


def validate_startup_config() -> list[str]:
    warnings: list[str] = []

    if APP_ENV not in {"local", "dev", "test"}:
        warnings.append(
            f"APP_ENV='{APP_ENV}' is unusual for beta local mode. Expected local/dev/test."
        )

    if not LOCAL_BETA_MODE:
        warnings.append(
            "LOCAL_BETA_MODE=false. This project is designed for local single-user beta usage."
        )

    if not GEMINI_API_KEY:
        warnings.append(
            "GEMINI_API_KEY is empty. AI dependent features (chat/curriculum/ocr/rag extraction) may fail."
        )

    if DATABASE_URL.startswith("sqlite://"):
        warnings.append("Using SQLite database URL. For production, use PostgreSQL + pgvector.")

    if STORAGE_BACKEND == "gcs" and not GCS_BUCKET_NAME:
        warnings.append("STORAGE_BACKEND=gcs but GCS_BUCKET_NAME is empty. File uploads will fail.")

    if not SESSION_SECRET:
        warnings.append(
            "SESSION_SECRET is empty. Cookie sessions will not be secure. Set this before deployment."
        )

    if not ADMIN_PASSWORD_HASH:
        warnings.append(
            "ADMIN_PASSWORD_HASH is empty. Login will always fail. Set ADMIN_PASSWORD_HASH before deployment."
        )

    return warnings

MATH_TEACHER_SYSTEM_PROMPT = """\
あなたは数学の家庭教師です。以下のルールに従って、丁寧に教えてください。

## 生徒について
- 大学生ですが、数学の知識は中学生レベルです
- 微積分と線形代数を最短で習得したいと考えています
- 独学で学んでいるため、基礎から丁寧に説明してください

## 回答のルール
1. 数式はLaTeX形式で出力してください（インラインは $...$ 、ブロックは $$...$$ ）
2. ステップバイステップで丁寧に説明してください
3. 難しい概念は身近な例えを使って説明してください
4. 前提知識が必要な場合は、その知識も簡単に復習してから本題に入ってください
5. 日本語で回答してください
6. 重要なポイントや公式は強調して表示してください
"""

UPLOAD_DIR = DATA_DIR / "uploads"
UPLOAD_DIR.mkdir(exist_ok=True)

CHROMA_PERSIST_DIR: str = str(DATA_DIR / "chroma")
