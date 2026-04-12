from app.routers.chat import _build_rag_reference_section


def test_build_rag_reference_section_with_results():
    rag_results = [
        {
            "content": "微分係数は極限で定義される。f'(x)=lim(h->0){f(x+h)-f(x)}/h",
            "metadata": {"material_id": 10, "chunk_index": 2},
        }
    ]
    material_name_map = {10: "calculus_notes.pdf"}

    section = _build_rag_reference_section(rag_results, material_name_map)

    assert "### 参照資料" in section
    assert "calculus_notes.pdf" in section
    assert "chunk 2" in section
    assert "該当箇所" in section


def test_build_rag_reference_section_without_results():
    section = _build_rag_reference_section([], {})

    assert section.endswith("なし")
    assert "### 参照資料" in section
