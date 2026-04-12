from sqlalchemy import create_engine, inspect, text
from sqlalchemy.orm import DeclarativeBase, sessionmaker

from app.config import DATABASE_URL

_is_sqlite = DATABASE_URL.startswith("sqlite://")
_engine_kwargs: dict = {}
if _is_sqlite:
    _engine_kwargs["connect_args"] = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, **_engine_kwargs)
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)


class Base(DeclarativeBase):
    pass


def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


def init_db():
    # PostgreSQL 使用時は pgvector 拡張を有効化
    if not _is_sqlite:
        with engine.begin() as conn:
            conn.execute(text("CREATE EXTENSION IF NOT EXISTS vector"))
    # モデルを全てインポートしてからテーブルを作成
    import app.models.chunk  # noqa: F401
    Base.metadata.create_all(bind=engine)
    _run_lightweight_migrations()


def _run_lightweight_migrations():
    inspector = inspect(engine)
    table_names = set(inspector.get_table_names())
    if "practice_problems" not in table_names:
        return

    existing_columns = {
        column["name"] for column in inspector.get_columns("practice_problems")
    }
    if "schema_data" not in existing_columns:
        with engine.begin() as connection:
            connection.execute(
                text("ALTER TABLE practice_problems ADD COLUMN schema_data JSON")
            )

    # practice_attempts の拡張カラムを後方互換で追加
    if "practice_attempts" in table_names:
        attempt_columns = {
            column["name"] for column in inspector.get_columns("practice_attempts")
        }
        statements: list[str] = []
        if "working_steps" not in attempt_columns:
            statements.append(
                "ALTER TABLE practice_attempts ADD COLUMN working_steps TEXT DEFAULT ''"
            )
        if "final_answer" not in attempt_columns:
            statements.append(
                "ALTER TABLE practice_attempts ADD COLUMN final_answer TEXT DEFAULT ''"
            )
        if "rubric_scores" not in attempt_columns:
            statements.append(
                "ALTER TABLE practice_attempts ADD COLUMN rubric_scores JSON"
            )
        if "mistake_summary" not in attempt_columns:
            statements.append(
                "ALTER TABLE practice_attempts ADD COLUMN mistake_summary JSON"
            )
        if "equivalence_note" not in attempt_columns:
            statements.append(
                "ALTER TABLE practice_attempts ADD COLUMN equivalence_note TEXT DEFAULT ''"
            )

        if statements:
            with engine.begin() as connection:
                for stmt in statements:
                    connection.execute(text(stmt))
