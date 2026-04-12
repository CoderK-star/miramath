from __future__ import annotations

from collections.abc import Generator

import pytest
from fastapi.testclient import TestClient
from passlib.context import CryptContext
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from app import config, database

# MaterialChunk モデルをテーブル登録のため先にインポート
import app.models.chunk  # noqa: F401

from app.main import app

_TEST_PASSWORD = "test-password"
_TEST_PASSWORD_HASH = CryptContext(schemes=["bcrypt"], deprecated="auto").hash(_TEST_PASSWORD)


@pytest.fixture
def client(tmp_path, monkeypatch) -> Generator[TestClient, None, None]:
    db_file = tmp_path / "test.db"
    test_engine = create_engine(
        f"sqlite:///{db_file}",
        connect_args={"check_same_thread": False},
    )
    test_session_local = sessionmaker(
        autocommit=False,
        autoflush=False,
        bind=test_engine,
    )

    monkeypatch.setattr(database, "engine", test_engine)
    monkeypatch.setattr(database, "SessionLocal", test_session_local)
    # SQLite テスト環境では pgvector 操作をスキップするためフラグを上書き
    monkeypatch.setattr(database, "_is_sqlite", True)
    monkeypatch.setattr(config, "ADMIN_PASSWORD_HASH", _TEST_PASSWORD_HASH)
    monkeypatch.setattr(config, "SESSION_SECRET", "test-secret")

    database.Base.metadata.create_all(bind=test_engine)

    with TestClient(app) as test_client:
        resp = test_client.post("/api/auth/login", json={"password": _TEST_PASSWORD})
        assert resp.status_code == 200, f"Test login failed: {resp.text}"
        yield test_client
