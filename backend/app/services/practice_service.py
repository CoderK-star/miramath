import json
import re
from collections.abc import Sequence
from typing import Any

from sqlalchemy import func
from sqlalchemy.orm import Session

from app.models.curriculum import CurriculumTopic
from app.models.practice import PracticeAttempt, PracticeProblem
from app.services.practice_schema import build_problem_payload
from app.services.ai_service import (
    generate_practice_problems_with_ai,
    grade_practice_answer,
)

RUBRIC_KEYS = ("concept", "calculation", "final_answer")
MISTAKE_TITLES = {
    "concept": "概念ミス",
    "calculation": "計算ミス",
    "final_answer": "最終答ミス",
}


def _extract_json(raw: str) -> dict[str, Any]:
    text = raw.strip()
    if "```json" in text:
        text = text.split("```json", 1)[1]
        text = text.split("```", 1)[0]
    elif "```" in text:
        text = text.split("```", 1)[1]
        text = text.split("```", 1)[0]
    return json.loads(text.strip())


def _clamp_score(value: Any) -> int:
    try:
        return max(0, min(100, int(value)))
    except (TypeError, ValueError):
        return 0


def get_topic_score_unit(total_problems: int) -> float:
    if total_problems <= 0:
        return 100.0
    return round(100.0 / total_problems, 2)


def scale_score_for_topic(raw_score: Any, total_problems: int) -> float:
    unit = get_topic_score_unit(total_problems)
    return round(unit * (_clamp_score(raw_score) / 100), 2)


def _normalize_rubric_scores(raw: Any) -> dict[str, int]:
    data = raw if isinstance(raw, dict) else {}
    return {key: _clamp_score(data.get(key, 0)) for key in RUBRIC_KEYS}


def _default_mistake_detail(
    key: str,
    score: int,
    has_working_steps: bool,
    equivalence_note: str,
) -> str:
    if key == "concept":
        if score >= 70:
            return "考え方は大きく外れていません。"
        if not has_working_steps:
            return "途中式がないため概念面の評価は限定的です。使った公式や方針も書いてください。"
        return "使う公式や定義の選び方にずれがあります。何を根拠に変形したかを見直しましょう。"
    if key == "calculation":
        if score >= 70:
            return "計算過程は概ね保てています。"
        if not has_working_steps:
            return "途中式がないため計算の崩れた箇所を特定しにくいです。1行ずつ書いてください。"
        return "途中の展開、符号、係数、約分のどこかで計算が崩れています。"
    if score >= 80:
        return equivalence_note or "最終解答は妥当です。"
    return equivalence_note or "最終行の整理、符号、定数、転記を見直してください。"


def _normalize_mistake_summary(
    raw: Any,
    rubric_scores: dict[str, int],
    has_working_steps: bool,
    equivalence_note: str = "",
) -> dict[str, dict[str, Any]]:
    source = raw if isinstance(raw, dict) else {}
    result: dict[str, dict[str, Any]] = {}

    for key in RUBRIC_KEYS:
        raw_entry = source.get(key)
        entry: dict[str, Any] = raw_entry if isinstance(raw_entry, dict) else {}
        score = _clamp_score(entry.get("score", rubric_scores.get(key, 0)))
        threshold = 80 if key == "final_answer" else 70
        has_issue = entry.get("has_issue")
        if not isinstance(has_issue, bool):
            has_issue = score < threshold
        result[key] = {
            "title": str(entry.get("title", MISTAKE_TITLES[key])).strip()
            or MISTAKE_TITLES[key],
            "score": score,
            "has_issue": has_issue,
            "detail": str(entry.get("detail", "")).strip()
            or _default_mistake_detail(
                key,
                score,
                has_working_steps,
                equivalence_note,
            ),
        }

    return result


def _build_submission_text(working_steps: str, final_answer: str) -> str:
    parts: list[str] = []
    if working_steps:
        parts.append("途中式:")
        parts.append(working_steps)
    if final_answer:
        if parts:
            parts.append("")
            parts.append("最終解答:")
            parts.append(final_answer)
        else:
            parts.append(final_answer)
    return "\n".join(parts).strip()


def _prepare_submission_payload(
    user_answer: str,
    working_steps: str,
    final_answer: str,
) -> dict[str, str]:
    legacy_answer = user_answer.strip()
    clean_steps = working_steps.strip()
    clean_final = final_answer.strip()

    if not clean_steps and not clean_final:
        return {
            "user_answer": legacy_answer,
            "working_steps": "",
            "final_answer": legacy_answer,
        }

    composed = _build_submission_text(clean_steps, clean_final)
    return {
        "user_answer": composed or legacy_answer,
        "working_steps": clean_steps,
        "final_answer": clean_final,
    }


def _normalize_question_type(value: str) -> str:
    if value in ("free_text", "multiple_choice"):
        return value
    return "free_text"


def _normalize_difficulty(value: str) -> str:
    if value in ("easy", "medium", "hard"):
        return value
    return "medium"


def _get_nested_text(item: dict[str, Any], field: str, nested_key: str) -> str:
    nested = item.get(field)
    if isinstance(nested, dict):
        value = nested.get(nested_key)
        if value is not None:
            return str(value).strip()
    return ""


def _extract_question_text(item: dict[str, Any]) -> str:
    prompt_text = _get_nested_text(item, "prompt", "text")
    if prompt_text:
        return prompt_text
    return str(item.get("question_text", "")).strip()


def _extract_solution_text(item: dict[str, Any]) -> str:
    solution_text = _get_nested_text(item, "solution", "text")
    if solution_text:
        return solution_text
    return str(item.get("solution_text", "")).strip()


def _extract_choice_options(item: dict[str, Any]) -> list[str] | None:
    legacy_options = item.get("options")
    if isinstance(legacy_options, Sequence) and not isinstance(legacy_options, (str, bytes)):
        values = [str(v).strip() for v in legacy_options if str(v).strip()]
        return values[:4] if values else None

    raw_choices = item.get("choices")
    if not isinstance(raw_choices, Sequence) or isinstance(raw_choices, (str, bytes)):
        return None

    extracted: list[str] = []
    for choice in raw_choices:
        if isinstance(choice, dict):
            display_text = str(choice.get("display_text", "")).strip()
            if display_text:
                extracted.append(display_text)
        elif choice is not None:
            text = str(choice).strip()
            if text:
                extracted.append(text)
    return extracted[:4] if extracted else None


def _extract_correct_answer(item: dict[str, Any], options: list[str] | None) -> str:
    answer = item.get("answer")
    if isinstance(answer, dict):
        display_text = str(answer.get("display_text", "")).strip()
        if display_text:
            return display_text

        canonical_text = str(answer.get("canonical_text", "")).strip()
        if canonical_text:
            return canonical_text

        correct_choice_id = str(answer.get("correct_choice_id", "")).strip()
        if correct_choice_id and options:
            raw_choices = item.get("choices")
            if isinstance(raw_choices, Sequence) and not isinstance(raw_choices, (str, bytes)):
                for choice in raw_choices:
                    if not isinstance(choice, dict):
                        continue
                    if str(choice.get("id", "")).strip() == correct_choice_id:
                        display_text = str(choice.get("display_text", "")).strip()
                        if display_text:
                            return display_text

    return str(item.get("correct_answer", "")).strip()


def _extract_schema_data(item: dict[str, Any]) -> dict[str, Any]:
    schema: dict[str, Any] = {
        "question_type": _normalize_question_type(
            str(item.get("question_type", "free_text"))
        ),
        "difficulty": _normalize_difficulty(
            str(item.get("difficulty", "medium"))
        ),
    }
    for key in ("prompt", "choices", "answer", "solution", "input_hints", "grading"):
        value = item.get(key)
        if value is not None:
            schema[key] = value
    return schema


def list_problems(
    db: Session,
    topic_id: int | None = None,
    difficulty: str | None = None,
    question_type: str | None = None,
) -> list[PracticeProblem]:
    q = db.query(PracticeProblem)
    if topic_id is not None:
        q = q.filter(PracticeProblem.topic_id == topic_id)
    if difficulty is not None:
        q = q.filter(PracticeProblem.difficulty == difficulty)
    if question_type is not None:
        q = q.filter(PracticeProblem.question_type == question_type)
    return q.order_by(PracticeProblem.created_at.desc()).all()


def get_problem_attempt_summary(
    db: Session, problem_id: int
) -> dict[str, int]:
    """Return attempt_count and best_score for a single problem."""
    rows = (
        db.query(PracticeAttempt)
        .filter(PracticeAttempt.problem_id == problem_id)
        .all()
    )
    if not rows:
        return {"attempt_count": 0, "best_score": 0}
    return {
        "attempt_count": len(rows),
        "best_score": max(a.score for a in rows),
    }


def list_attempts_for_problem(
    db: Session, problem_id: int, limit: int = 50
) -> list[PracticeAttempt]:
    safe_limit = max(1, min(limit, 200))
    return (
        db.query(PracticeAttempt)
        .filter(PracticeAttempt.problem_id == problem_id)
        .order_by(PracticeAttempt.submitted_at.desc(), PracticeAttempt.id.desc())
        .limit(safe_limit)
        .all()
    )


def delete_problem(db: Session, problem_id: int) -> bool:
    problem = db.query(PracticeProblem).filter(PracticeProblem.id == problem_id).first()
    if not problem:
        return False
    db.delete(problem)
    db.commit()
    return True


def delete_problems_by_topic(db: Session, topic_id: int) -> int:
    problems = (
        db.query(PracticeProblem)
        .filter(PracticeProblem.topic_id == topic_id)
        .all()
    )
    count = len(problems)
    for p in problems:
        db.delete(p)
    db.commit()
    return count


async def generate_problems(
    db: Session,
    topic_id: int,
    difficulty: str,
    count: int,
) -> list[PracticeProblem]:
    topic = db.query(CurriculumTopic).filter(CurriculumTopic.id == topic_id).first()
    if not topic:
        raise ValueError("topic not found")

    safe_count = max(1, min(count, 10))
    safe_difficulty = _normalize_difficulty(difficulty)

    raw = await generate_practice_problems_with_ai(
        topic_title=topic.title,
        topic_description=topic.description,
        difficulty=safe_difficulty,
        count=safe_count,
    )
    data = _extract_json(raw)
    problems = data.get("problems", [])
    if not isinstance(problems, list) or len(problems) == 0:
        raise ValueError("generated problems are empty")

    created: list[PracticeProblem] = []
    for item in problems:
        if not isinstance(item, dict):
            continue
        q_type = _normalize_question_type(str(item.get("question_type", "free_text")))
        item_difficulty = _normalize_difficulty(str(item.get("difficulty", safe_difficulty)))
        question_text = _extract_question_text(item)
        solution_text = _extract_solution_text(item)
        options = _extract_choice_options(item)
        correct_answer = _extract_correct_answer(item, options)
        schema_data = _extract_schema_data(item)

        if q_type == "multiple_choice":
            if not options or len(options) < 2:
                q_type = "free_text"

        if not question_text or not correct_answer:
            continue

        p = PracticeProblem(
            topic_id=topic_id,
            question_type=q_type,
            difficulty=item_difficulty,
            question_text=question_text,
            options=options,
            correct_answer=correct_answer,
            solution_text=solution_text,
            schema_data=schema_data,
        )
        db.add(p)
        created.append(p)

    if not created:
        raise ValueError("failed to create practice problems")

    db.commit()
    for p in created:
        db.refresh(p)
    return created


def _normalize_text(value: str) -> str:
    text = value.strip().lower()
    text = text.replace("$", "")
    text = text.replace("\\", "")
    text = re.sub(r"\s+", "", text)
    return text


def _is_balanced_parentheses(value: str) -> bool:
    depth = 0
    for char in value:
        if char == "(":
            depth += 1
        elif char == ")":
            depth -= 1
            if depth < 0:
                return False
    return depth == 0


def _strip_outer_parentheses(value: str) -> str:
    text = value.strip()
    while (
        len(text) >= 2
        and text.startswith("(")
        and text.endswith(")")
        and _is_balanced_parentheses(text[1:-1])
    ):
        text = text[1:-1].strip()
    return text


def _split_top_level(value: str, operators: set[str]) -> list[str]:
    text = value.strip()
    if not text:
        return []

    parts: list[str] = []
    depth = 0
    start = 0
    prev = ""
    for index, char in enumerate(text):
        if char == "(":
            depth += 1
            prev = char
            continue
        if char == ")":
            depth = max(0, depth - 1)
            prev = char
            continue
        if depth == 0 and char in operators:
            if char in "+-" and (index == 0 or prev in "(+-*/^="):
                prev = char
                continue
            parts.append(text[start:index].strip())
            start = index
        prev = char
    parts.append(text[start:].strip())
    return [part for part in parts if part]


def _normalize_latex_expression(value: str) -> str:
    text = value.strip().lower()
    text = text.replace("$", "")
    text = text.replace(r"\left", "")
    text = text.replace(r"\right", "")
    text = text.replace(r"\dfrac", r"\frac")
    text = text.replace(r"\tfrac", r"\frac")
    text = text.replace(r"\cdot", "*")
    text = text.replace(r"\times", "*")
    text = text.replace(r"\div", "/")
    text = text.replace(r"\,", "")
    text = re.sub(r"\\frac\s*\{([^{}]+)\}\s*\{([^{}]+)\}", r"((\1)/(\2))", text)
    text = re.sub(r"\\sqrt\s*\[([^\]]+)\]\s*\{([^{}]+)\}", r"root(\1,\2)", text)
    text = re.sub(r"\\sqrt\s*\{([^{}]+)\}", r"sqrt(\1)", text)
    text = re.sub(r"\\(?:mathrm|text|operatorname)\s*\{([^{}]+)\}", r"\1", text)
    text = re.sub(r"\\(sin|cos|tan|log|ln|exp)\b", r"\1", text)
    text = re.sub(r"\^\{([^{}]+)\}", r"^\1", text)
    text = re.sub(r"_\{([^{}]+)\}", r"_\1", text)
    text = text.replace("{", "(").replace("}", ")")
    text = re.sub(r"\s+", "", text)
    return text


def _insert_implicit_multiplication(value: str) -> str:
    text = value
    text = re.sub(r"(?<=[0-9a-z_)])(?=\()", "*", text)
    text = re.sub(r"(?<=\))(?=[0-9a-z_(])", "*", text)
    text = re.sub(r"(?<=[0-9])(?=[a-z])", "*", text)
    return text


def _normalize_atomic(value: str) -> str:
    text = _strip_outer_parentheses(value)
    if not text:
        return ""
    if text.startswith("+"):
        text = text[1:]
    return text


def _canonicalize_sum(value: str) -> str:
    text = _strip_outer_parentheses(value)
    terms = _split_top_level(text, {"+", "-"})
    if len(terms) <= 1:
        return _canonicalize_product(text)

    normalized_terms: list[str] = []
    for term in terms:
        sign = ""
        core = term
        if core.startswith("+"):
            core = core[1:]
        elif core.startswith("-"):
            sign = "-"
            core = core[1:]
        normalized_terms.append(f"{sign}{_canonicalize_product(core)}")

    normalized_terms.sort(key=lambda item: (item.startswith("-"), item.lstrip("+-")))
    result = normalized_terms[0]
    for item in normalized_terms[1:]:
        result += item if item.startswith("-") else f"+{item}"
    return result


def _expand_product_terms(factors: list[str]) -> list[str] | None:
    term_groups: list[list[str]] = []
    combination_count = 1
    for factor in factors:
        factor_text = _strip_outer_parentheses(factor)
        terms = _split_top_level(factor_text, {"+", "-"})
        if len(terms) > 1:
            term_groups.append(terms)
            combination_count *= len(terms)
        else:
            term_groups.append([factor_text])
        if combination_count > 12:
            return None

    if all(len(group) == 1 for group in term_groups):
        return None

    expanded = [""]
    for group in term_groups:
        next_terms: list[str] = []
        for prefix in expanded:
            for item in group:
                next_terms.append(f"{prefix}*{item}" if prefix else item)
        expanded = next_terms
    return expanded


def _canonicalize_product(value: str) -> str:
    text = _strip_outer_parentheses(value)
    factors = _split_top_level(text, {"*"})
    if len(factors) <= 1:
        return _normalize_atomic(text)

    expanded_terms = _expand_product_terms(factors)
    if expanded_terms is not None:
        return _canonicalize_sum("+".join(expanded_terms))

    normalized_factors = [_normalize_atomic(_canonicalize_sum(factor)) for factor in factors]
    normalized_factors = [factor for factor in normalized_factors if factor]
    normalized_factors.sort()
    return "*".join(normalized_factors)


def _canonicalize_expression(value: str) -> str:
    text = _strip_outer_parentheses(value)
    if not text:
        return ""
    if text.count("=") == 1:
        left, right = text.split("=", 1)
        left_norm = _canonicalize_sum(left)
        right_norm = _canonicalize_sum(right)
        return "=".join(sorted((left_norm, right_norm)))
    return _canonicalize_sum(text)


def _normalize_symbolic_text(value: str) -> str:
    text = _normalize_latex_expression(value)
    text = re.sub(r"\b(sin|cos|tan|log|ln|exp|sqrt)\s+([a-z0-9]+)", r"\1(\2)", text)
    text = re.sub(r"\b(sin|cos|tan|log|ln|exp|sqrt)\(([^()]+)\)", r"\1(\2)", text)
    text = _insert_implicit_multiplication(text)
    text = text.replace("+-", "-")
    text = text.replace("--", "+")
    text = _canonicalize_expression(text)
    text = re.sub(r"\s+", "", text)
    return text


def _choice_key(value: str) -> str:
    text = value.strip().lower()
    text = text.replace("（", "(").replace("）", ")")
    text = text.replace("選択肢", "")
    text = re.sub(r"\s+", "", text)
    return text


def _extract_numeric(value: str) -> float | None:
    m = re.search(r"[-+]?\d+(?:\.\d+)?", value)
    if not m:
        return None
    try:
        return float(m.group(0))
    except ValueError:
        return None


def _token_overlap_ratio(a: str, b: str) -> float:
    tok_a = set(re.findall(r"[a-zA-Z0-9_\-\+\*/\^=]+", a))
    tok_b = set(re.findall(r"[a-zA-Z0-9_\-\+\*/\^=]+", b))
    if not tok_a or not tok_b:
        return 0.0
    return len(tok_a & tok_b) / max(len(tok_b), 1)


def _get_choice_aliases(
    choice: dict[str, Any],
    index: int,
    grading: dict[str, Any],
) -> set[str]:
    aliases = {
        _choice_key(str(choice.get("display_text", ""))),
        _choice_key(str(choice.get("value_text", ""))),
    }
    if bool(grading.get("accept_choice_labels", False)):
        aliases.add(_choice_key(str(choice.get("id", ""))))
        aliases.add(_choice_key(str(choice.get("label", ""))))
    if bool(grading.get("accept_choice_indices", False)):
        aliases.add(str(index + 1))
    aliases.discard("")
    return aliases


def _find_correct_choice(
    problem_payload: dict[str, Any],
) -> tuple[dict[str, Any] | None, int | None]:
    choices = problem_payload.get("choices")
    answer = problem_payload.get("answer")
    if not isinstance(choices, Sequence) or isinstance(choices, (str, bytes)):
        return None, None
    if not isinstance(answer, dict):
        return None, None

    correct_choice_id = str(answer.get("correct_choice_id", "")).strip()
    display_text = str(answer.get("display_text", "")).strip()
    canonical_text = str(answer.get("canonical_text", "")).strip()

    for index, choice in enumerate(choices):
        if not isinstance(choice, dict):
            continue
        if correct_choice_id and str(choice.get("id", "")).strip() == correct_choice_id:
            return choice, index
        if display_text and str(choice.get("display_text", "")).strip() == display_text:
            return choice, index
        if canonical_text and str(choice.get("value_text", "")).strip() == canonical_text:
            return choice, index

    return None, None


def _grade_multiple_choice(problem_payload: dict[str, Any], user_answer: str) -> dict[str, Any]:
    answer = problem_payload.get("answer")
    grading = problem_payload.get("grading")
    if not isinstance(answer, dict):
        answer = {}
    if not isinstance(grading, dict):
        grading = {}

    normalized_user = _choice_key(user_answer)
    correct_choice, correct_index = _find_correct_choice(problem_payload)
    answer_text = str(answer.get("display_text", "")).strip() or str(
        problem_payload.get("correct_answer", "")
    ).strip()

    if correct_choice is not None and correct_index is not None:
        accepted_aliases = _get_choice_aliases(correct_choice, correct_index, grading)
        if normalized_user in accepted_aliases:
            return {
                "score": 100,
                "is_correct": True,
                "feedback": "正解です。選択肢の判断が正確です。",
                "mistake_points": [],
                "next_hint": "なぜその選択肢が正しいかを言語化してみましょう。",
            }

    normalized_correct = _choice_key(answer_text)
    if normalized_user and normalized_user == normalized_correct:
        return {
            "score": 100,
            "is_correct": True,
            "feedback": "正解です。選択肢の判断が正確です。",
            "mistake_points": [],
            "next_hint": "なぜその選択肢が正しいかを言語化してみましょう。",
        }

    return {
        "score": 0,
        "is_correct": False,
        "feedback": f"不正解です。正しい選択肢は「{answer_text}」です。",
        "mistake_points": ["選択肢の判定が誤っています。"],
        "next_hint": "定義や公式に照らして、各選択肢を1つずつ消去法で確認しましょう。",
    }


def _build_free_text_candidates(answer: dict[str, Any]) -> list[str]:
    candidates: list[str] = []
    for key in ("canonical_text", "display_text"):
        value = str(answer.get(key, "")).strip()
        if value and value not in candidates:
            candidates.append(value)

    variants = answer.get("accepted_variants")
    if isinstance(variants, Sequence) and not isinstance(variants, (str, bytes)):
        for variant in variants:
            text = str(variant).strip()
            if text and text not in candidates:
                candidates.append(text)
    return candidates


def _fallback_grade_free_text(
    problem_payload: dict[str, Any],
    user_answer: str,
    working_steps: str = "",
    final_answer: str = "",
) -> dict[str, Any]:
    answer = problem_payload.get("answer")
    grading = problem_payload.get("grading")
    if not isinstance(answer, dict):
        answer = {}
    if not isinstance(grading, dict):
        grading = {}

    working_steps = working_steps.strip()
    final_answer = final_answer.strip()
    effective_answer = final_answer or user_answer.strip()
    combined_answer = _build_submission_text(working_steps, final_answer) or user_answer.strip()
    has_working_steps = bool(working_steps)
    canonical_text = str(answer.get("canonical_text", "")).strip() or str(
        problem_payload.get("correct_answer", "")
    ).strip()
    candidates = _build_free_text_candidates(answer)
    equivalence_mode = str(grading.get("equivalence_mode", "ai"))
    normalized_user = _normalize_text(effective_answer)
    normalized_candidates = {_normalize_text(candidate) for candidate in candidates if candidate}
    normalized_symbolic_user = _normalize_symbolic_text(effective_answer)
    normalized_symbolic_candidates = {
        _normalize_symbolic_text(candidate) for candidate in candidates if candidate
    }

    if normalized_user and normalized_user in normalized_candidates:
        rubric_scores = {
            "concept": 85 if has_working_steps else 70,
            "calculation": 85 if has_working_steps else 70,
            "final_answer": 100,
        }
        equivalence_note = "最終解答が模範解答と一致しています。"
        return {
            "score": 100,
            "is_correct": True,
            "feedback": "正解です。最終解答が一致しています。",
            "mistake_points": [],
            "next_hint": "別解があるかも確認してみましょう。",
            "rubric_scores": rubric_scores,
            "mistake_summary": _normalize_mistake_summary(
                None,
                rubric_scores,
                has_working_steps,
                equivalence_note,
            ),
            "equivalence_note": equivalence_note,
        }

    if equivalence_mode in {"symbolic", "symbolic_or_ai"}:
        if normalized_symbolic_user and normalized_symbolic_user in normalized_symbolic_candidates:
            rubric_scores = {
                "concept": 85 if has_working_steps else 70,
                "calculation": 85 if has_working_steps else 70,
                "final_answer": 100,
            }
            equivalence_note = "表記は異なりますが、最終解答は数式として同値です。"
            return {
                "score": 100,
                "is_correct": True,
                "feedback": "正解です。表記は異なりますが、数式として同値です。",
                "mistake_points": [],
                "next_hint": "別の同値変形でも同じ答えになることを確認してみましょう。",
                "rubric_scores": rubric_scores,
                "mistake_summary": _normalize_mistake_summary(
                    None,
                    rubric_scores,
                    has_working_steps,
                    equivalence_note,
                ),
                "equivalence_note": equivalence_note,
            }

    num_user = _extract_numeric(effective_answer)
    num_correct = _extract_numeric(canonical_text)
    if num_user is not None and num_correct is not None:
        diff = abs(num_user - num_correct)
        if diff <= max(0.01, abs(num_correct) * 0.01):
            rubric_scores = {
                "concept": 75 if has_working_steps else 60,
                "calculation": 75 if has_working_steps else 60,
                "final_answer": 85,
            }
            equivalence_note = "数値的にはほぼ一致していますが、式の表記や厳密性に差があります。"
            return {
                "score": 85,
                "is_correct": True,
                "feedback": "数値的にはほぼ正解です。表記や厳密性を改善すると満点に近づきます。",
                "mistake_points": ["厳密な式変形または表記が不足している可能性があります。"],
                "next_hint": "途中式と単位（必要なら）を明記してみましょう。",
                "rubric_scores": rubric_scores,
                "mistake_summary": _normalize_mistake_summary(
                    None,
                    rubric_scores,
                    has_working_steps,
                    equivalence_note,
                ),
                "equivalence_note": equivalence_note,
            }

    best_overlap = 0.0
    for candidate in candidates or [canonical_text]:
        best_overlap = max(
            best_overlap,
            _token_overlap_ratio(combined_answer.lower(), candidate.lower()),
        )

    partial = int(round(20 + best_overlap * 45))
    keywords = grading.get("keywords")
    valid_keywords: list[str] = []
    matched_keywords = 0
    if isinstance(keywords, Sequence) and not isinstance(keywords, (str, bytes)):
        valid_keywords = [str(keyword).strip() for keyword in keywords if str(keyword).strip()]
        matched_keywords = sum(
            1
            for keyword in valid_keywords
            if keyword in combined_answer
        )
        if matched_keywords:
            partial += min(10, matched_keywords * 5)
    partial = max(15, min(70, partial))

    keyword_ratio = matched_keywords / len(valid_keywords) if valid_keywords else (1.0 if has_working_steps else 0.0)
    concept_score = int(round(35 + keyword_ratio * 45))
    if not has_working_steps:
        concept_score = min(concept_score, 45)
    calculation_score = int(round(25 + best_overlap * 55))
    if not has_working_steps:
        calculation_score = min(calculation_score, 50)
    final_answer_score = int(round(20 + best_overlap * 40))
    rubric_scores = {
        "concept": max(0, min(100, concept_score)),
        "calculation": max(0, min(100, calculation_score)),
        "final_answer": max(0, min(100, final_answer_score)),
    }

    feedback = "一部は合っていますが、最終解答に至る論理か計算に不足があります。"
    if equivalence_mode == "exact":
        feedback = "最終解答の表記が模範解答と一致していません。"
    equivalence_note = "模範解答と数式として一致するところまで到達していません。"
    return {
        "score": partial,
        "is_correct": False,
        "feedback": feedback,
        "mistake_points": ["模範解答との差分を確認し、途中の変形を見直しましょう。"],
        "next_hint": "式変形を1行ずつ書き、どこで値が変わったかを追跡してください。",
        "rubric_scores": rubric_scores,
        "mistake_summary": _normalize_mistake_summary(
            None,
            rubric_scores,
            has_working_steps,
            equivalence_note,
        ),
        "equivalence_note": equivalence_note,
    }


def _fallback_grade(problem_payload: dict[str, Any], user_answer: str) -> dict[str, Any]:
    if problem_payload.get("question_type") == "multiple_choice":
        return _grade_multiple_choice(problem_payload, user_answer)
    return _fallback_grade_free_text(problem_payload, user_answer)


async def submit_attempt(
    db: Session,
    problem_id: int,
    user_answer: str,
    working_steps: str = "",
    final_answer: str = "",
) -> dict[str, Any]:
    problem = db.query(PracticeProblem).filter(PracticeProblem.id == problem_id).first()
    if not problem:
        raise ValueError("problem not found")

    payload = build_problem_payload(problem)
    submission = _prepare_submission_payload(user_answer, working_steps, final_answer)

    # 四択はAIを介さず、厳密に判定する（採点の一貫性を優先）。
    if problem.question_type == "multiple_choice":
        answer_text = submission["final_answer"] or submission["user_answer"]
        grade_data = _grade_multiple_choice(payload, answer_text)
        mc_score = 100 if grade_data.get("is_correct", False) else 0
        grade_data["rubric_scores"] = {
            "concept": mc_score,
            "calculation": mc_score,
            "final_answer": mc_score,
        }
        grade_data["mistake_summary"] = _normalize_mistake_summary(
            {
                "concept": {
                    "title": "概念ミス",
                    "score": mc_score,
                    "has_issue": not grade_data.get("is_correct", False),
                    "detail": (
                        "選択肢の根拠は妥当です。"
                        if grade_data.get("is_correct", False)
                        else "定義や公式の理解と選択肢の照合を見直しましょう。"
                    ),
                },
                "calculation": {
                    "title": "計算ミス",
                    "score": mc_score,
                    "has_issue": not grade_data.get("is_correct", False),
                    "detail": (
                        "選択問題のため計算過程の減点はありません。"
                        if grade_data.get("is_correct", False)
                        else "選択問題のため途中計算は見えませんが、候補の比較がずれています。"
                    ),
                },
                "final_answer": {
                    "title": "最終答ミス",
                    "score": mc_score,
                    "has_issue": not grade_data.get("is_correct", False),
                    "detail": (
                        "正しい選択肢を選べています。"
                        if grade_data.get("is_correct", False)
                        else "選択した答えが正答と一致していません。"
                    ),
                },
            },
            grade_data["rubric_scores"],
            False,
        )
        grade_data["equivalence_note"] = "選択肢IDの一致で判定しました。"
    else:
        grade_data: dict[str, Any]
        try:
            raw_grade = await grade_practice_answer(payload, submission)
            parsed = _extract_json(raw_grade)
            rubric_scores = _normalize_rubric_scores(parsed.get("rubric_scores", {}))
            concept = rubric_scores["concept"]
            calculation = rubric_scores["calculation"]
            final_answer_score = rubric_scores["final_answer"]
            weighted = int(round(concept * 0.35 + calculation * 0.35 + final_answer_score * 0.30))

            model_score = int(parsed.get("score", weighted))
            score = int(round(model_score * 0.5 + weighted * 0.5)) if weighted > 0 else model_score
            score = max(0, min(100, score))

            is_correct = bool(parsed.get("is_correct", False)) or score >= 80
            equivalence_note = str(parsed.get("equivalence_note", "")).strip()
            grade_data = {
                "score": score,
                "is_correct": is_correct,
                "feedback": str(parsed.get("feedback", "")),
                "mistake_points": parsed.get("mistake_points", []),
                "next_hint": str(parsed.get("next_hint", "")),
                "rubric_scores": rubric_scores,
                "mistake_summary": _normalize_mistake_summary(
                    parsed.get("mistake_summary"),
                    rubric_scores,
                    bool(submission["working_steps"]),
                    equivalence_note,
                ),
                "equivalence_note": equivalence_note,
            }

            if not grade_data["feedback"]:
                raise ValueError("empty feedback from model")
        except Exception:
            grade_data = _fallback_grade_free_text(
                payload,
                submission["user_answer"],
                working_steps=submission["working_steps"],
                final_answer=submission["final_answer"],
            )

    score = max(0, min(100, int(grade_data.get("score", 0))))
    attempt = PracticeAttempt(
        problem_id=problem.id,
        user_answer=submission["user_answer"],
        working_steps=submission["working_steps"],
        final_answer=submission["final_answer"],
        score=score,
        is_correct=bool(grade_data.get("is_correct", False)),
        feedback=str(grade_data.get("feedback", "")),
        mistake_points=grade_data.get("mistake_points", []),
        next_hint=str(grade_data.get("next_hint", "")),
        rubric_scores=_normalize_rubric_scores(grade_data.get("rubric_scores", {})),
        mistake_summary=_normalize_mistake_summary(
            grade_data.get("mistake_summary"),
            _normalize_rubric_scores(grade_data.get("rubric_scores", {})),
            bool(submission["working_steps"]),
            str(grade_data.get("equivalence_note", "")),
        ),
        equivalence_note=str(grade_data.get("equivalence_note", "")),
    )
    db.add(attempt)
    db.commit()
    db.refresh(attempt)
    return {
        "attempt": attempt,
        "working_steps": submission["working_steps"],
        "final_answer": submission["final_answer"],
        "rubric_scores": _normalize_rubric_scores(grade_data.get("rubric_scores", {})),
        "mistake_summary": _normalize_mistake_summary(
            grade_data.get("mistake_summary"),
            _normalize_rubric_scores(grade_data.get("rubric_scores", {})),
            bool(submission["working_steps"]),
            str(grade_data.get("equivalence_note", "")),
        ),
        "equivalence_note": str(grade_data.get("equivalence_note", "")),
    }


def get_stats(db: Session, topic_id: int | None = None) -> dict[str, Any]:
    q = db.query(PracticeAttempt, PracticeProblem).join(
        PracticeProblem, PracticeAttempt.problem_id == PracticeProblem.id
    )
    if topic_id is not None:
        q = q.filter(PracticeProblem.topic_id == topic_id)

    rows = q.all()
    total_attempts = len(rows)
    if total_attempts == 0:
        return {
            "total_attempts": 0,
            "avg_score": 0.0,
            "accuracy_rate": 0.0,
        }

    topic_problem_counts: dict[int, int] = {}
    total_score = 0.0
    for attempt, problem in rows:
        current_topic_id = problem.topic_id
        if current_topic_id not in topic_problem_counts:
            topic_problem_counts[current_topic_id] = count_problems(db, topic_id=current_topic_id)
        total_score += scale_score_for_topic(attempt.score, topic_problem_counts[current_topic_id])
    correct_count = sum(1 for a, _ in rows if a.is_correct)

    return {
        "total_attempts": total_attempts,
        "avg_score": round(total_score / total_attempts, 2),
        "accuracy_rate": round(correct_count / total_attempts, 4),
    }


def count_problems(db: Session, topic_id: int | None = None) -> int:
    q = db.query(func.count(PracticeProblem.id))
    if topic_id is not None:
        q = q.filter(PracticeProblem.topic_id == topic_id)
    value = q.scalar()
    return int(value or 0)


def get_weak_topics(db: Session, limit: int = 5) -> list[dict[str, Any]]:
    safe_limit = max(1, min(limit, 20))

    rows = (
        db.query(PracticeAttempt, PracticeProblem, CurriculumTopic)
        .join(PracticeProblem, PracticeAttempt.problem_id == PracticeProblem.id)
        .join(CurriculumTopic, PracticeProblem.topic_id == CurriculumTopic.id)
        .all()
    )

    if not rows:
        return []

    aggregates: dict[int, dict[str, Any]] = {}

    for attempt, problem, topic in rows:
        bucket = aggregates.setdefault(
            topic.id,
            {
                "topic_id": topic.id,
                "topic_title": topic.title,
                "attempt_count": 0,
                "score_sum": 0.0,
                "concept_issues": 0,
                "calculation_issues": 0,
                "final_answer_issues": 0,
            },
        )

        bucket["attempt_count"] += 1
        bucket["score_sum"] += float(attempt.score)

        summary = attempt.mistake_summary if isinstance(attempt.mistake_summary, dict) else {}
        rubric = attempt.rubric_scores if isinstance(attempt.rubric_scores, dict) else {}

        concept_issue = bool(summary.get("concept", {}).get("has_issue")) if isinstance(summary.get("concept"), dict) else _clamp_score(rubric.get("concept", 0)) < 70
        calculation_issue = bool(summary.get("calculation", {}).get("has_issue")) if isinstance(summary.get("calculation"), dict) else _clamp_score(rubric.get("calculation", 0)) < 70
        final_issue = bool(summary.get("final_answer", {}).get("has_issue")) if isinstance(summary.get("final_answer"), dict) else _clamp_score(rubric.get("final_answer", 0)) < 80

        if concept_issue:
            bucket["concept_issues"] += 1
        if calculation_issue:
            bucket["calculation_issues"] += 1
        if final_issue:
            bucket["final_answer_issues"] += 1

    result: list[dict[str, Any]] = []
    for item in aggregates.values():
        attempt_count = int(item["attempt_count"])
        avg_score = round(float(item["score_sum"]) / max(attempt_count, 1), 2)
        issue_total = int(item["concept_issues"] + item["calculation_issues"] + item["final_answer_issues"])
        # 低スコアと弱点件数を組み合わせた優先度。値が高いほど優先。
        priority_score = round(
            issue_total * 1.5
            + max(0.0, (75.0 - avg_score)) / 6.0
            + min(2.0, attempt_count * 0.1),
            3,
        )

        result.append(
            {
                "topic_id": int(item["topic_id"]),
                "topic_title": str(item["topic_title"]),
                "attempt_count": attempt_count,
                "avg_score": avg_score,
                "concept_issues": int(item["concept_issues"]),
                "calculation_issues": int(item["calculation_issues"]),
                "final_answer_issues": int(item["final_answer_issues"]),
                "priority_score": priority_score,
            }
        )

    result.sort(
        key=lambda x: (
            x["priority_score"],
            x["attempt_count"],
            -x["avg_score"],
        ),
        reverse=True,
    )
    return result[:safe_limit]