import logging
from time import perf_counter
from uuid import uuid4

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from starlette.middleware.sessions import SessionMiddleware

from app.config import APP_ENV, FRONTEND_ORIGINS, SESSION_SECRET, validate_startup_config
from app.database import init_db
from app.error_handlers import register_exception_handlers
from app.logging_setup import configure_logging
from app.routers import auth, chat, curriculum, materials, notes, practice, progress, settings

configure_logging()
app = FastAPI(title="Miramath", version="1.0.0")
logger = logging.getLogger(__name__)

# セッションミドルウェア（CORSより先に追加し、内側に配置）
app.add_middleware(
    SessionMiddleware,
    secret_key=SESSION_SECRET or "dev-secret-change-in-production",
    same_site="lax",
    https_only=APP_ENV not in {"local", "dev"},
    max_age=86400 * 30,  # 30日
)
# CORS設定（フロントエンドからのアクセスを許可）
app.add_middleware(
    CORSMiddleware,
    allow_origins=FRONTEND_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ルーター登録
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(curriculum.router)
app.include_router(materials.router)
app.include_router(progress.router)
app.include_router(practice.router)
app.include_router(notes.router)
app.include_router(settings.router)
register_exception_handlers(app)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next) -> Response:
    request_id = str(uuid4())
    request.state.request_id = request_id

    start_time = perf_counter()
    response = await call_next(request)
    elapsed_ms = (perf_counter() - start_time) * 1000

    response.headers["X-Request-ID"] = request_id
    logger.info(
        (
            "request.completed "
            "method=%s path=%s status=%s elapsed_ms=%.2f request_id=%s"
        ),
        request.method,
        request.url.path,
        response.status_code,
        elapsed_ms,
        request_id,
    )
    return response


@app.on_event("startup")
def on_startup():
    init_db()
    for warning in validate_startup_config():
        logger.warning("startup config warning: %s", warning)


@app.get("/health")
def health():
    return {"status": "ok", "app": "Miramath"}
