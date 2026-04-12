from sqlalchemy import ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base, _is_sqlite

# SQLite 環境ではベクトル型が使えないため JSON テキストにフォールバック
if _is_sqlite:
    from sqlalchemy import Column

    class MaterialChunk(Base):
        __tablename__ = "material_chunks"

        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        material_id: Mapped[int] = mapped_column(
            Integer, ForeignKey("materials.id", ondelete="CASCADE")
        )
        chunk_index: Mapped[int] = mapped_column(Integer)
        content: Mapped[str] = mapped_column(Text)
        # SQLite 用: embedding を JSON テキストとして保存
        embedding: Mapped[str] = mapped_column(Text, nullable=True)
        file_type: Mapped[str] = mapped_column(String(20))

else:
    from pgvector.sqlalchemy import Vector  # type: ignore[import]

    class MaterialChunk(Base):  # type: ignore[no-redef]
        __tablename__ = "material_chunks"

        id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
        material_id: Mapped[int] = mapped_column(
            Integer, ForeignKey("materials.id", ondelete="CASCADE")
        )
        chunk_index: Mapped[int] = mapped_column(Integer)
        content: Mapped[str] = mapped_column(Text)
        # pgvector: text-embedding-004 は 768 次元
        embedding = mapped_column(Vector(768), nullable=True)
        file_type: Mapped[str] = mapped_column(String(20))
