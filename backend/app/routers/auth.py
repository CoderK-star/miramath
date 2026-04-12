import logging

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel

from app.services.auth_service import verify_password

router = APIRouter(prefix="/api/auth", tags=["auth"])
logger = logging.getLogger(__name__)


class LoginRequest(BaseModel):
    password: str


@router.post("/login")
def login(body: LoginRequest, request: Request):
    if not verify_password(body.password):
        logger.warning(
            "login.failed ip=%s",
            request.client.host if request.client else "unknown",
        )
        raise HTTPException(status_code=401, detail="パスワードが正しくありません")
    request.session["authenticated"] = True
    logger.info(
        "login.success ip=%s",
        request.client.host if request.client else "unknown",
    )
    return {"ok": True}


@router.post("/logout")
def logout(request: Request):
    request.session.clear()
    return {"ok": True}


@router.get("/me")
def me(request: Request):
    if not request.session.get("authenticated"):
        raise HTTPException(status_code=401, detail="未認証")
    return {"authenticated": True}
