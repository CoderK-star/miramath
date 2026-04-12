from fastapi import APIRouter, Depends
from pydantic import BaseModel, field_validator

from app.dependencies import require_session
from app.services.runtime_settings import (
    get_runtime_llm_settings,
    update_runtime_llm_settings,
)

router = APIRouter(
    prefix="/api/settings",
    tags=["settings"],
    dependencies=[Depends(require_session)],
)


class LLMSettingsOut(BaseModel):
    system_prompt: str


class LLMSettingsUpdateRequest(BaseModel):
    system_prompt: str

    @field_validator("system_prompt")
    @classmethod
    def validate_required_text(cls, value: str) -> str:
        normalized = value.strip()
        if not normalized:
            raise ValueError("必須項目です")
        return value


@router.get("/llm", response_model=LLMSettingsOut)
def get_llm_settings():
    settings = get_runtime_llm_settings()
    return LLMSettingsOut(
        system_prompt=settings["system_prompt"],
    )


@router.put("/llm", response_model=LLMSettingsOut)
def put_llm_settings(body: LLMSettingsUpdateRequest):
    updated = update_runtime_llm_settings(
        system_prompt=body.system_prompt,
    )
    return LLMSettingsOut(
        system_prompt=updated["system_prompt"],
    )
