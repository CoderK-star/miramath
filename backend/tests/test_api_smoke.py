from __future__ import annotations


def test_health(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["status"] == "ok"


def test_chat_conversations_flow(client):
    created = client.post("/api/chat/conversations")
    assert created.status_code == 200
    conv = created.json()
    conv_id = conv["id"]

    listed = client.get("/api/chat/conversations")
    assert listed.status_code == 200
    assert any(c["id"] == conv_id for c in listed.json())

    deleted = client.delete(f"/api/chat/conversations/{conv_id}")
    assert deleted.status_code == 200


def test_curriculum_get(client):
    response = client.get("/api/curriculum")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_materials_list(client):
    response = client.get("/api/materials")
    assert response.status_code == 200
    assert isinstance(response.json(), list)


def test_progress_summary(client):
    response = client.get("/api/progress/summary")
    assert response.status_code == 200
    body = response.json()
    assert "total_topics" in body
    assert "completion_rate" in body


def test_notes_crud(client):
    payload = {
        "title": "積分メモ",
        "category": "calculus",
        "image_data": "data:image/png;base64,aaa",
    }
    created = client.post("/api/notes", json=payload)
    assert created.status_code == 200
    note = created.json()

    listed = client.get("/api/notes")
    assert listed.status_code == 200
    assert any(n["id"] == note["id"] for n in listed.json())

    updated = client.patch(
        f"/api/notes/{note['id']}",
        json={
            "title": "積分メモ更新",
            "category": "calculus",
            "image_data": "data:image/png;base64,bbb",
        },
    )
    assert updated.status_code == 200
    assert updated.json()["title"] == "積分メモ更新"

    deleted = client.delete(f"/api/notes/{note['id']}")
    assert deleted.status_code == 200


def test_practice_stats(client):
    response = client.get("/api/practice/stats")
    assert response.status_code == 200
    body = response.json()
    assert "total_attempts" in body
    assert "accuracy_rate" in body


def test_exception_contract_not_found(client):
    response = client.get("/api/notes/999999")
    assert response.status_code == 405 or response.status_code == 404

    # Force an endpoint that returns 404 from app code path.
    response2 = client.delete("/api/notes/999999")
    assert response2.status_code == 404
    body = response2.json()
    assert "error" in body
    assert body["error"]["code"] == "http_error"
    assert "request_id" in body["error"]
