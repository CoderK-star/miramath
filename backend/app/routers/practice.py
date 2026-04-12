from __future__ import annotations

from datetime import datetime
from pathlib import Path
from typing import Literal, cast
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app.config import UPLOAD_DIR
from app.database import get_db
from app.dependencies import require_session
from app.models.practice import PracticeAttempt, PracticeProblem
from app.services.ai_service import extract_math_answer_from_image
from app.services.practice_schema import build_problem_payload
from app.services.practice_service import (
    count_problems,
    delete_problem,
    delete_problems_by_topic,
    generate_problems,
    get_weak_topics,
    get_problem_attempt_summary,
    get_stats,
    get_topic_score_unit,
    list_attempts_for_problem,
    list_problems,
    scale_score_for_topic,
    submit_attempt,
)

router = APIRouter(prefix="/api/practice", tags=["practice"], dependencies=[Depends(require_session)])

ALLOWED_IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif"}

QuestionType = Literal["free_text", "multiple_choice"]
Difficulty = Literal["easy", "medium", "hard"]
MathFormat = Literal["markdown_latex", "plain_text"]
PreferredInputMode = Literal["text", "math", "choice", "image"]
EquivalenceMode = Literal["exact", "symbolic", "ai", "symbolic_or_ai"]

QUESTION_TYPES: tuple[QuestionType, ...] = ("free_text", "multiple_choice")
DIFFICULTIES: tuple[Difficulty, ...] = ("easy", "medium", "hard")


def _to_iso(dt: datetime | None) -> str:
    if dt is None:
        raise ValueError("datetime is required")
    return dt.isoformat()


def _to_question_type(value: str) -> QuestionType:
    if value not in QUESTION_TYPES:
        raise ValueError(f"invalid question_type: {value}")
    return cast(QuestionType, value)


def _to_difficulty(value: str) -> Difficulty:
    if value not in DIFFICULTIES:
        raise ValueError(f"invalid difficulty: {value}")
    return cast(Difficulty, value)


class GenerateProblemsRequest(BaseModel):
    topic_id: int
    difficulty: str = "medium"
    count: int = Field(default=3, ge=1, le=10)


class PracticeProblemOut(BaseModel):
    id: int
    topic_id: int
    question_type: QuestionType
    difficulty: Difficulty
    question_text: str
    options: list[str] | None
    correct_answer: str
    solution_text: str
    prompt: PracticePromptSpec
    choices: list[PracticeChoiceSpec] | None = None
    answer: PracticeAnswerSpec
    solution: PracticeSolutionSpec
    input_hints: PracticeInputHintsSpec
    grading: PracticeGradingSpec
    created_at: str
    attempt_count: int = 0
    best_score: float = 0.0
    max_score: float = 100.0


class GenerateProblemsResponse(BaseModel):
    problems: list[PracticeProblemOut]


class SubmitAttemptRequest(BaseModel):
    problem_id: int
    user_answer: str = ""
    working_steps: str = ""
    final_answer: str = ""


class PracticeRubricScoresOut(BaseModel):
    concept: int = 0
    calculation: int = 0
    final_answer: int = 0


class PracticeMistakeCategoryOut(BaseModel):
    title: str
    score: int
    has_issue: bool
    detail: str


class PracticeMistakeSummaryOut(BaseModel):
    concept: PracticeMistakeCategoryOut
    calculation: PracticeMistakeCategoryOut
    final_answer: PracticeMistakeCategoryOut


class PracticeAttemptOut(BaseModel):
    id: int
    problem_id: int
    user_answer: str
    working_steps: str = ""
    final_answer: str = ""
    score: float
    max_score: float = 100.0
    is_correct: bool
    feedback: str
    mistake_points: list[str] | None
    next_hint: str
    rubric_scores: PracticeRubricScoresOut
    mistake_summary: PracticeMistakeSummaryOut
    equivalence_note: str = ""
    submitted_at: str


class PracticeStatsOut(BaseModel):
    total_attempts: int
    total_problems: int
    avg_score: float
    accuracy_rate: float


class PracticeWeakTopicOut(BaseModel):
    topic_id: int
    topic_title: str
    attempt_count: int
    avg_score: float
    concept_issues: int
    calculation_issues: int
    final_answer_issues: int
    priority_score: float


class ExtractAnswerImageOut(BaseModel):
    extracted_text: str


class PracticePromptSpec(BaseModel):
    text: str
    math_format: MathFormat = "markdown_latex"


class PracticeChoiceSpec(BaseModel):
    id: str
    label: str
    display_text: str
    value_text: str


class PracticeAnswerSpec(BaseModel):
    display_text: str
    canonical_text: str
    accepted_variants: list[str] = Field(default_factory=list)
    correct_choice_id: str | None = None


class PracticeSolutionSpec(BaseModel):
    text: str
    math_format: MathFormat = "markdown_latex"


class PracticeInputHintsSpec(BaseModel):
    preferred_mode: PreferredInputMode = "text"
    template_keys: list[str] = Field(default_factory=list)
    allow_handwritten_image: bool = False


class PracticeGradingSpec(BaseModel):
    equivalence_mode: EquivalenceMode = "ai"
    accept_choice_labels: bool = False
    accept_choice_indices: bool = False
    keywords: list[str] = Field(default_factory=list)


class GeneratedPracticeProblemSpec(BaseModel):
    question_type: QuestionType
    difficulty: Difficulty
    prompt: PracticePromptSpec
    choices: list[PracticeChoiceSpec] | None = None
    answer: PracticeAnswerSpec
    solution: PracticeSolutionSpec
    input_hints: PracticeInputHintsSpec = Field(default_factory=PracticeInputHintsSpec)
    grading: PracticeGradingSpec = Field(default_factory=PracticeGradingSpec)


class GeneratedPracticeProblemsEnvelope(BaseModel):
    problems: list[GeneratedPracticeProblemSpec]


def _problem_to_out(
    p: PracticeProblem,
    attempt_count: int = 0,
    best_score: float = 0.0,
    max_score: float = 100.0,
) -> PracticeProblemOut:
    payload = build_problem_payload(p)
    raw_choices = payload.get("choices")
    choices = (
        [PracticeChoiceSpec.model_validate(choice) for choice in raw_choices]
        if isinstance(raw_choices, list)
        else None
    )

    return PracticeProblemOut(
        id=p.id,
        topic_id=p.topic_id,
        question_type=_to_question_type(p.question_type),
        difficulty=_to_difficulty(p.difficulty),
        question_text=p.question_text,
        options=p.options,
        correct_answer=p.correct_answer,
        solution_text=p.solution_text,
        prompt=PracticePromptSpec.model_validate(payload["prompt"]),
        choices=choices,
        answer=PracticeAnswerSpec.model_validate(payload["answer"]),
        solution=PracticeSolutionSpec.model_validate(payload["solution"]),
        input_hints=PracticeInputHintsSpec.model_validate(payload["input_hints"]),
        grading=PracticeGradingSpec.model_validate(payload["grading"]),
        created_at=_to_iso(p.created_at),
        attempt_count=attempt_count,
        best_score=best_score,
        max_score=max_score,
    )


def _attempt_to_out(
    a: PracticeAttempt,
    working_steps: str = "",
    final_answer: str = "",
    rubric_scores: dict[str, int] | None = None,
    mistake_summary: dict[str, dict[str, object]] | None = None,
    equivalence_note: str = "",
    total_problems: int = 1,
) -> PracticeAttemptOut:
    stored_rubric = a.rubric_scores if isinstance(a.rubric_scores, dict) else {}
    stored_summary = a.mistake_summary if isinstance(a.mistake_summary, dict) else None
    max_score = get_topic_score_unit(total_problems)

    return PracticeAttemptOut(
        id=a.id,
        problem_id=a.problem_id,
        user_answer=a.user_answer,
        working_steps=working_steps or a.working_steps or "",
        final_answer=final_answer or a.final_answer or "",
        score=scale_score_for_topic(a.score, total_problems),
        max_score=max_score,
        is_correct=a.is_correct,
        feedback=a.feedback,
        mistake_points=a.mistake_points,
        next_hint=a.next_hint,
        rubric_scores=PracticeRubricScoresOut.model_validate(
            rubric_scores or stored_rubric
        ),
        mistake_summary=PracticeMistakeSummaryOut.model_validate(
            mistake_summary
            or stored_summary
            or {
                "concept": {
                    "title": "概念ミス",
                    "score": 0,
                    "has_issue": True,
                    "detail": "評価データがありません。",
                },
                "calculation": {
                    "title": "計算ミス",
                    "score": 0,
                    "has_issue": True,
                    "detail": "評価データがありません。",
                },
                "final_answer": {
                    "title": "最終答ミス",
                    "score": 0,
                    "has_issue": True,
                    "detail": "評価データがありません。",
                },
            }
        ),
        equivalence_note=equivalence_note or a.equivalence_note or "",
        submitted_at=_to_iso(a.submitted_at),
    )


@router.post("/problems/generate", response_model=GenerateProblemsResponse)
async def generate_problems_endpoint(
    body: GenerateProblemsRequest,
    db: Session = Depends(get_db),
):
    try:
        problems = await generate_problems(
            db,
            topic_id=body.topic_id,
            difficulty=body.difficulty,
            count=body.count,
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"problem generation failed: {e}")

    total_problems = count_problems(db, topic_id=body.topic_id)
    max_score = get_topic_score_unit(total_problems)
    return GenerateProblemsResponse(
        problems=[_problem_to_out(p, max_score=max_score) for p in problems]
    )


@router.get("/problems", response_model=list[PracticeProblemOut])
def list_problems_endpoint(
    topic_id: int | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
    db: Session = Depends(get_db),
):
    problems = list_problems(
        db, topic_id=topic_id, difficulty=difficulty, question_type=question_type
    )
    result = []
    for p in problems:
        total_problems = count_problems(db, topic_id=p.topic_id)
        max_score = get_topic_score_unit(total_problems)
        summary = get_problem_attempt_summary(db, p.id)
        result.append(
            _problem_to_out(
                p,
                summary["attempt_count"],
                scale_score_for_topic(summary["best_score"], total_problems),
                max_score,
            )
        )
    return result


@router.delete("/problems/{problem_id}")
def delete_problem_endpoint(problem_id: int, db: Session = Depends(get_db)):
    if not delete_problem(db, problem_id):
        raise HTTPException(status_code=404, detail="problem not found")
    return {"detail": "deleted"}


@router.delete("/problems")
def delete_problems_endpoint(
    topic_id: int | None = None, db: Session = Depends(get_db)
):
    count = delete_problems_by_topic(db, topic_id) if topic_id else 0
    return {"deleted_count": count}


@router.post("/attempts", response_model=PracticeAttemptOut)
async def submit_attempt_endpoint(
    body: SubmitAttemptRequest,
    db: Session = Depends(get_db),
):
    has_input = any(
        value.strip()
        for value in (body.user_answer, body.working_steps, body.final_answer)
    )
    if not has_input:
        raise HTTPException(status_code=400, detail="answer input is required")
    try:
        result = await submit_attempt(
            db,
            problem_id=body.problem_id,
            user_answer=body.user_answer.strip(),
            working_steps=body.working_steps.strip(),
            final_answer=body.final_answer.strip(),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    problem = db.query(PracticeProblem).filter(PracticeProblem.id == body.problem_id).first()
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    total_problems = count_problems(db, topic_id=problem.topic_id)
    return _attempt_to_out(
        result["attempt"],
        working_steps=str(result.get("working_steps", "")),
        final_answer=str(result.get("final_answer", "")),
        rubric_scores=result.get("rubric_scores"),
        mistake_summary=result.get("mistake_summary"),
        equivalence_note=str(result.get("equivalence_note", "")),
        total_problems=total_problems,
    )


@router.get("/attempts", response_model=list[PracticeAttemptOut])
def list_attempts_endpoint(
    problem_id: int,
    limit: int = 50,
    db: Session = Depends(get_db),
):
    problem = db.query(PracticeProblem).filter(PracticeProblem.id == problem_id).first()
    if problem is None:
        raise HTTPException(status_code=404, detail="problem not found")
    total_problems = count_problems(db, topic_id=problem.topic_id)
    attempts = list_attempts_for_problem(db, problem_id=problem_id, limit=limit)
    return [_attempt_to_out(a, total_problems=total_problems) for a in attempts]


@router.post("/answers/extract-image", response_model=ExtractAnswerImageOut)
async def extract_answer_image_endpoint(file: UploadFile = File(...)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="ファイル名が必要です")

    ext = Path(file.filename).suffix.lower()
    if ext not in ALLOWED_IMAGE_EXTENSIONS:
        raise HTTPException(status_code=400, detail="画像ファイルをアップロードしてください")

    saved_name = f"practice-answer-{uuid4().hex}{ext}"
    save_path = UPLOAD_DIR / saved_name

    try:
        content = await file.read()
        save_path.write_bytes(content)
        extracted_text = (await extract_math_answer_from_image(str(save_path))).strip()
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"画像の読み取りに失敗しました: {e}")
    finally:
        if save_path.exists():
            save_path.unlink()

    if not extracted_text:
        raise HTTPException(status_code=422, detail="画像から数式を読み取れませんでした")

    return ExtractAnswerImageOut(extracted_text=extracted_text)


@router.get("/stats", response_model=PracticeStatsOut)
def stats_endpoint(topic_id: int | None = None, db: Session = Depends(get_db)):
    stats = get_stats(db, topic_id=topic_id)
    total_problems = count_problems(db, topic_id=topic_id)
    return PracticeStatsOut(
        total_attempts=stats["total_attempts"],
        total_problems=total_problems,
        avg_score=float(stats["avg_score"]),
        accuracy_rate=float(stats["accuracy_rate"]),
    )


@router.get("/weak-topics", response_model=list[PracticeWeakTopicOut])
def weak_topics_endpoint(limit: int = 5, db: Session = Depends(get_db)):
    return [PracticeWeakTopicOut(**item) for item in get_weak_topics(db, limit=limit)]