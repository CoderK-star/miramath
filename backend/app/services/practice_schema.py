from app.models.practice import PracticeProblem


def _as_dict(value: object) -> dict[str, object]:
    if isinstance(value, dict):
        return value
    return {}


def _as_list_of_dicts(value: object) -> list[dict[str, str]] | None:
    if not isinstance(value, list):
        return None

    rows: list[dict[str, str]] = []
    for item in value:
        if not isinstance(item, dict):
            continue
        row = {
            "id": str(item.get("id", "")).strip(),
            "label": str(item.get("label", "")).strip(),
            "display_text": str(item.get("display_text", "")).strip(),
            "value_text": str(item.get("value_text", "")).strip(),
        }
        if row["id"] and row["display_text"]:
            if not row["label"]:
                row["label"] = row["id"]
            if not row["value_text"]:
                row["value_text"] = row["display_text"]
            rows.append(row)

    return rows or None


def infer_template_keys(problem: PracticeProblem) -> list[str]:
    text = " ".join(
        [problem.question_text, problem.correct_answer, problem.solution_text]
    ).lower()
    keys: list[str] = []
    checks = [
        ("微分", "derivative"),
        ("偏微分", "partial_derivative"),
        ("積分", "integral"),
        ("定積分", "definite_integral"),
        ("極限", "limit"),
        ("総和", "summation"),
        ("行列", "matrix"),
        ("ベクトル", "vector"),
        ("対数", "logarithm"),
        ("指数", "exponential"),
        ("三角", "trigonometric"),
        ("sqrt", "root"),
        ("|", "absolute_value"),
        ("/", "fraction"),
        ("^", "power"),
        ("(", "parentheses"),
    ]
    for needle, key in checks:
        if needle in text and key not in keys:
            keys.append(key)
    return keys


def build_choices_data(problem: PracticeProblem) -> list[dict[str, str]] | None:
    if problem.question_type != "multiple_choice" or not problem.options:
        return None

    labels = ["A", "B", "C", "D"]
    choices: list[dict[str, str]] = []
    for index, option in enumerate(problem.options[:4]):
        label = labels[index] if index < len(labels) else str(index + 1)
        choices.append(
            {
                "id": label,
                "label": label,
                "display_text": option,
                "value_text": option,
            }
        )
    return choices


def build_answer_data(
    problem: PracticeProblem,
    choices: list[dict[str, str]] | None,
) -> dict[str, str | list[str] | None]:
    correct_choice_id: str | None = None
    canonical_text = problem.correct_answer
    if choices:
        for choice in choices:
            if choice["display_text"] == problem.correct_answer:
                correct_choice_id = choice["id"]
                canonical_text = choice["value_text"]
                break

    return {
        "display_text": problem.correct_answer,
        "canonical_text": canonical_text,
        "accepted_variants": [],
        "correct_choice_id": correct_choice_id,
    }


def build_input_hints_data(problem: PracticeProblem) -> dict[str, str | list[str] | bool]:
    if problem.question_type == "multiple_choice":
        return {
            "preferred_mode": "choice",
            "template_keys": [],
            "allow_handwritten_image": False,
        }

    return {
        "preferred_mode": "math",
        "template_keys": infer_template_keys(problem),
        "allow_handwritten_image": True,
    }


def build_grading_data(problem: PracticeProblem) -> dict[str, str | bool | list[str]]:
    if problem.question_type == "multiple_choice":
        return {
            "equivalence_mode": "exact",
            "accept_choice_labels": True,
            "accept_choice_indices": True,
            "keywords": [],
        }

    return {
        "equivalence_mode": "symbolic_or_ai",
        "accept_choice_labels": False,
        "accept_choice_indices": False,
        "keywords": [],
    }


def build_problem_payload(problem: PracticeProblem) -> dict[str, object]:
    stored = _as_dict(problem.schema_data)

    choices = _as_list_of_dicts(stored.get("choices")) or build_choices_data(problem)
    answer = _as_dict(stored.get("answer")) or build_answer_data(problem, choices)
    prompt = _as_dict(stored.get("prompt")) or {
        "text": problem.question_text,
        "math_format": "markdown_latex",
    }
    solution = _as_dict(stored.get("solution")) or {
        "text": problem.solution_text,
        "math_format": "markdown_latex",
    }
    input_hints = _as_dict(stored.get("input_hints")) or build_input_hints_data(problem)
    grading = _as_dict(stored.get("grading")) or build_grading_data(problem)

    prompt.setdefault("text", problem.question_text)
    prompt.setdefault("math_format", "markdown_latex")
    solution.setdefault("text", problem.solution_text)
    solution.setdefault("math_format", "markdown_latex")
    answer.setdefault("display_text", problem.correct_answer)
    answer.setdefault("canonical_text", problem.correct_answer)
    answer.setdefault("accepted_variants", [])
    answer.setdefault("correct_choice_id", None)
    input_hints.setdefault(
        "preferred_mode",
        "choice" if problem.question_type == "multiple_choice" else "math",
    )
    input_hints.setdefault("template_keys", infer_template_keys(problem))
    input_hints.setdefault(
        "allow_handwritten_image", problem.question_type != "multiple_choice"
    )
    grading.setdefault(
        "equivalence_mode",
        "exact" if problem.question_type == "multiple_choice" else "symbolic_or_ai",
    )
    grading.setdefault("accept_choice_labels", problem.question_type == "multiple_choice")
    grading.setdefault("accept_choice_indices", problem.question_type == "multiple_choice")
    grading.setdefault("keywords", [])

    return {
        "question_type": str(stored.get("question_type", problem.question_type)),
        "difficulty": str(stored.get("difficulty", problem.difficulty)),
        "question_text": problem.question_text,
        "options": problem.options,
        "correct_answer": problem.correct_answer,
        "solution_text": problem.solution_text,
        "prompt": prompt,
        "choices": choices,
        "answer": answer,
        "solution": solution,
        "input_hints": input_hints,
        "grading": grading,
    }