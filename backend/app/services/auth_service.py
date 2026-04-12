from passlib.context import CryptContext

from app import config

_pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password: str) -> bool:
    """入力パスワードを保存済みハッシュと照合する。"""
    if not config.ADMIN_PASSWORD_HASH:
        return False
    return _pwd_context.verify(plain_password, config.ADMIN_PASSWORD_HASH)
