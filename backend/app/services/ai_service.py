from collections.abc import AsyncGenerator
from pathlib import Path
import re
import base64
import tempfile
import os
import binascii
import logging
from typing import Any, cast

from google import genai
from app.config import GEMINI_MODEL_NAME
from google.genai import types

from app.config import GEMINI_API_KEY as _GEMINI_API_KEY
from app.services.runtime_settings import get_runtime_llm_settings

MODEL_NAME: str = GEMINI_MODEL_NAME
_client: genai.Client | None = None
logger = logging.getLogger(__name__)


def _get_client() -> genai.Client:
    global _client

    if not _GEMINI_API_KEY:
        raise RuntimeError(
            "GEMINI_API_KEY が設定されていません。環境変数を確認してください。"
        )

    if _client is None:
        _client = genai.Client(api_key=_GEMINI_API_KEY)
    return _client


def _build_config(system_instruction: str | None = None) -> types.GenerateContentConfig:
    settings = get_runtime_llm_settings()
    return types.GenerateContentConfig(
        system_instruction=system_instruction or settings["system_prompt"],
    )


def _build_history(messages: list[dict[str, Any]]) -> list[types.Content]:
    """メッセージ履歴をGemini APIの形式に変換する。"""
    history: list[types.Content] = []
    for msg in messages:
        role = "user" if msg["role"] == "user" else "model"
        history.append(
            types.Content(
                role=role,
                parts=[types.Part.from_text(text=str(msg["content"]))],
            )
        )
    return history


async def _recognize_handwriting_image(image_base64: str) -> str:
    """手書き画像(base64)をOCRして正規化済みテキストを返す。"""
    if not image_base64.startswith("data:image"):
        return ""

    temp_file = None
    try:
        try:
            header, data = image_base64.split(",", 1)
        except ValueError:
            logger.warning("Handwriting OCR decode stage failed: invalid data URL header")
            return ""

        mime_type = "image/png"
        if ":" in header and ";" in header:
            try:
                mime_type = header.split(":", 1)[1].split(";", 1)[0]
            except Exception:
                logger.warning("Handwriting OCR decode stage failed: invalid mime in header=%s", header)

        ext = mime_type.split("/")[1] if "/" in mime_type else "png"

        try:
            image_bytes = base64.b64decode(data, validate=True)
        except (binascii.Error, ValueError):
            logger.warning("Handwriting OCR decode stage failed: invalid base64 payload")
            return ""

        try:
            with tempfile.NamedTemporaryFile(suffix=f".{ext}", delete=False) as tf:
                tf.write(image_bytes)
                temp_file = tf.name
        except Exception:
            logger.exception("Handwriting OCR decode stage failed: could not create temp file")
            return ""

        try:
            recognized = await extract_math_answer_from_image(temp_file)
            return recognized.strip()
        except Exception:
            logger.exception("Handwriting OCR generate stage failed")
            return ""

    except Exception:
        logger.exception("Handwriting OCR unexpected failure")
        return ""
    finally:
        if temp_file and os.path.exists(temp_file):
            try:
                os.remove(temp_file)
            except Exception:
                logger.warning("Handwriting OCR cleanup failed: temp_file=%s", temp_file)


async def chat_stream(
    user_message: str,
    history: list[dict[str, Any]],
    image_path: str | None = None,
) -> AsyncGenerator[str, None]:
    """ストリーミングでAI応答を生成する。"""
    client = _get_client()
    chat = client.chats.create(
        model=MODEL_NAME,
        config=_build_config(),
        history=cast(Any, _build_history(history)),
    )

    parts: list[Any] = []

    if image_path:
        path = Path(image_path)
        if path.exists():
            uploaded = client.files.upload(file=path)
            parts.append(uploaded)

    parts.append(user_message)

    response = chat.send_message_stream(parts)
    for chunk in response:
        if chunk.text:
            yield chunk.text


async def generate_curriculum_with_ai() -> str:
    """AIにカリキュラムのJSON構造を生成させる。"""
    client = _get_client()

    prompt = """\
中学レベルの数学知識を持つ大学生が、微積分と線形代数を最短で習得するための学習カリキュラムを作成してください。

以下のJSON形式で出力してください。他のテキストは含めず、JSONのみを出力してください:

```json
{
  "units": [
    {
      "title": "大単元名",
      "description": "説明",
      "sections": [
        {
          "title": "小単元名",
          "description": "説明",
          "topics": [
            {
              "title": "トピック名",
              "description": "このトピックで学ぶ内容の簡潔な説明"
            }
          ]
        }
      ]
    }
  ]
}
```

要件:
- 中学数学の復習から始めること
- 高校数学I, II, IIIの重要な内容を含むこと
- 微積分（多変数を含む）と線形代数の大学レベルまで到達すること
- 各トピックは1回の学習セッション（30-60分）で完了できる粒度にすること
- 前提知識が自然に積み上がる順序にすること
"""

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=_build_config(
            system_instruction="あなたは数学教育の専門家です。日本語で回答してください。"
        ),
    )
    return response.text or ""


async def extract_text_from_image(image_path: str, prompt: str = "") -> str:
    """画像からテキストを抽出する（Gemini Vision）。"""
    client = _get_client()
    try:
        uploaded = client.files.upload(file=Path(image_path))
    except Exception:
        logger.exception("Handwriting OCR upload stage failed: image_path=%s", image_path)
        raise

    msg = prompt or "この画像の内容をテキストとして抽出してください。数式がある場合はLaTeX形式で書いてください。"
    try:
        response = client.models.generate_content(
            model=MODEL_NAME,
            contents=[uploaded, msg],
            config=_build_config(
                system_instruction="画像の内容をテキストに変換してください。数式はLaTeX形式で出力してください。"
            ),
        )
    except Exception:
        logger.exception("Handwriting OCR generate stage failed: image_path=%s", image_path)
        raise

    return response.text or ""


def _strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    if cleaned.startswith("```"):
        parts = cleaned.split("\n")
        if parts:
            parts = parts[1:]
        if parts and parts[-1].strip() == "```":
            parts = parts[:-1]
        cleaned = "\n".join(parts).strip()
    return cleaned


def _normalize_math_ocr_output(text: str) -> str:
    cleaned = _strip_code_fences(text)
    cleaned = cleaned.replace("¥", "\\").replace("＼", "\\")
    cleaned = cleaned.replace("−", "-").replace("–", "-").replace("—", "-")
    cleaned = cleaned.replace("×", r"\\times ").replace("÷", r"\\div ")
    cleaned = cleaned.replace("→", r"\\to ").replace("∞", r"\\infty")
    cleaned = cleaned.replace("≤", r"\\le ").replace("≥", r"\\ge ")
    cleaned = cleaned.replace("≠", r"\\neq ")
    cleaned = cleaned.replace("²", "^2").replace("³", "^3")
    cleaned = cleaned.replace("₀", "_0").replace("₁", "_1").replace("₂", "_2").replace("₃", "_3")
    cleaned = cleaned.replace("₄", "_4").replace("₅", "_5").replace("₆", "_6").replace("₇", "_7")
    cleaned = cleaned.replace("₈", "_8").replace("₉", "_9")

    cleaned = re.sub(r"^(抽出結果|読み取り結果|OCR結果)\s*[:：]\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\\\\([A-Za-z])", r"\\\1", cleaned)

    # Normalize common OCR variants before math-specific shaping.
    cleaned = re.sub(r"\b1im\b", "lim", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bl n\b", "ln", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bl o g\b", "log", cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r"(?<!\\)∫", r"\\int ", cleaned)
    cleaned = re.sub(r"(?<!\\)Σ", r"\\sum ", cleaned)
    cleaned = re.sub(r"(?<!\\)Π", r"\\prod ", cleaned)

    # Derivatives and partial derivatives.
    cleaned = re.sub(
        r"(?<!\\)d\s*y\s*/\s*d\s*x",
        r"\\frac{dy}{dx}",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"(?<!\\)d\s*/\s*d\s*x",
        r"\\frac{d}{dx}",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"(?<!\\)∂\s*y\s*/\s*∂\s*x",
        r"\\frac{\\partial y}{\\partial x}",
        cleaned,
    )

    # Limits and function names.
    cleaned = re.sub(
        r"(?<!\\)lim\s*x\s*(?:->|\\to)\s*([A-Za-z0-9+\-]+)",
        r"\\lim_{x \\to \1}",
        cleaned,
        flags=re.IGNORECASE,
    )
    cleaned = re.sub(
        r"(?<!\\)\b(sin|cos|tan|log|ln|exp)\s*(?=[A-Za-z0-9(])",
        lambda m: f"\\\\{m.group(1).lower()} ",
        cleaned,
        flags=re.IGNORECASE,
    )

    # Simple numeric fractions like 3/4 -> \frac{3}{4}.
    cleaned = re.sub(
        r"(?<![\\\w}])(\d+)\s*/\s*(\d+)(?![\w{])",
        r"\\frac{\1}{\2}",
        cleaned,
    )

    cleaned = re.sub(r"√\s*\(([^\n]+?)\)", r"\\sqrt{\1}", cleaned)
    cleaned = re.sub(r"√\s*([A-Za-z0-9]+)", r"\\sqrt{\1}", cleaned)
    cleaned = re.sub(r"\b([a-zA-Z])\s*\^\s*([0-9]+)\b", r"\1^\2", cleaned)
    cleaned = re.sub(r"\b([a-zA-Z])\s*_\s*([0-9]+)\b", r"\1_\2", cleaned)

    # Add thin-space before differential in integral expressions.
    cleaned = re.sub(r"(\\int[^\n]*?)\s+d([a-zA-Z])\b", r"\1 \\, d\2", cleaned)

    cleaned = re.sub(r"[ \t]+\n", "\n", cleaned)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return cleaned.strip()


async def extract_math_answer_from_image(image_path: str) -> str:
    """手書き数学答案の画像から、採点用のテキストを抽出する。"""
    prompt = """\
この画像には、学習者が紙に手書きした数学の答案または数式が写っています。

以下のルールで読み取ってください:
- 画像内の数式や文章だけを抽出する
- 返答は抽出結果のみとし、説明文は付けない
- 数式はできるだけ LaTeX 形式で表す
- 分数は \\frac{a}{b}、平方根は \\sqrt{x}、積分は \\int、極限は \\lim、添字と累乗は _ と ^ を使う
- 微分は \\frac{d}{dx} や \\frac{dy}{dx} のように表す
- 行列、ベクトル、総和、積、三角関数も可能なら LaTeX で表す
- 数式だけでなく、答案中の等号や途中式の改行順も保つ
- 行が複数ある場合は改行を保つ
- Markdown のコードブロックは使わない
- 「抽出結果:」などの前置きは付けない
- 読み取りに自信がない箇所は、推測で補わず見えた範囲だけを書く
- 途中式が複数行ある場合も、そのまま順番を保つ

特に注意する点:
- x^2, x_1, \\frac{{dy}}{{dx}}, \\int_0^1 x^2 \\, dx のような形を優先する
- 1/2 のような単純な分数でも、可能なら \\frac{1}{2} と表す
- 手書きの d, x, y, 1, l, / を取り違えないように注意する
- 画像に問題文と解答が両方ある場合は、解答として書かれている部分を優先する
"""
    raw_text = await extract_text_from_image(image_path, prompt=prompt)
    return _normalize_math_ocr_output(raw_text)


async def generate_practice_problems_with_ai(
    topic_title: str,
    topic_description: str,
    difficulty: str,
    count: int,
) -> str:
    """トピックに応じた問題演習データをJSONで生成する。"""
    client = _get_client()
    prompt = f"""\
次のトピックについて、数学の問題を {count} 問作成してください。

トピック名: {topic_title}
トピック説明: {topic_description}
難易度: {difficulty}

要件:
- 問題タイプは free_text または multiple_choice
- multiple_choice は選択肢を4つ用意
- 中学レベルから大学初級への学習者に分かる日本語で作成
- 数式を含む表示用テキストは markdown + LaTeX で記述する
- 表示用データと採点用データを分ける
- ただし既存システム互換のため、旧フィールドも必ず埋める
- multiple_choice は choices[].id と answer.correct_choice_id を必ず整合させる
- free_text は answer.canonical_text を最も標準的な数式表現にする
- accepted_variants には数学的に等価で、学習者が実際に入力しそうな代表表現を 2 から 5 個まで入れる
- accepted_variants は free_text でのみ充実させる。multiple_choice では通常は空配列でよい
- accepted_variants には次の種類を優先して含める: 展開形と因数分解形、項の順序入れ替え、a/b と \frac{{a}}{{b}}、冪の括弧ありなし、関数表記の軽微な差
- ただし誤答になり得る曖昧表現や、数学的に別物になる表現は入れない
- 例: canonical が x^2+3x+2 なら accepted_variants に x^2+2+3x, (x+1)(x+2) を含めてよい
- 例: canonical が \frac{{x+1}}{{2}} なら accepted_variants に (x+1)/2, \frac{{1+x}}{{2}} を含めてよい
- 例: canonical が \\sin(x) なら accepted_variants に sin(x), \\sin x を含めてよい
- input_hints.template_keys は次から必要なものを選ぶ: derivative, partial_derivative, integral, definite_integral, limit, summation, root, nth_root, absolute_value, vector, matrix, trigonometric, logarithm, exponential, power, parentheses, fraction
- input_hints.allow_handwritten_image は free_text なら true、multiple_choice なら false を基本とする

次のJSONのみを返してください:
```json
{{
  "problems": [
    {{
            "question_type": "free_text",
            "difficulty": "medium",

            "prompt": {{
                "text": "問題文。数式は必要なら $...$ や $$...$$ を使う",
                "math_format": "markdown_latex"
            }},

            "choices": null,

            "answer": {{
                "display_text": "学習者に見せる模範解答。数式は $...$ でよい",
                "canonical_text": "採点の中心に使う正規化された答え",
                "accepted_variants": ["等価な別表現1", "等価な別表現2"],
                "correct_choice_id": null
            }},

            "solution": {{
                "text": "解法の説明。数式は必要なら $...$ や $$...$$ を使う",
                "math_format": "markdown_latex"
            }},

            "input_hints": {{
                "preferred_mode": "math",
                "template_keys": ["derivative", "power", "parentheses"],
                "allow_handwritten_image": true
            }},

            "grading": {{
                "equivalence_mode": "symbolic_or_ai",
                "accept_choice_labels": false,
                "accept_choice_indices": false,
                "keywords": ["連鎖律"]
            }},

            "question_text": "既存互換用の問題文",
            "options": null,
            "correct_answer": "既存互換用の模範解答",
            "solution_text": "既存互換用の解法の説明"
    }},
    {{
      "question_type": "multiple_choice",
            "difficulty": "medium",

            "prompt": {{
                "text": "問題文。数式は必要なら $...$ や $$...$$ を使う",
                "math_format": "markdown_latex"
            }},

            "choices": [
                {{
                    "id": "A",
                    "label": "A",
                    "display_text": "学習者向けの表示内容。数式は $...$ でよい",
                    "value_text": "内部判定用の選択肢文字列"
                }},
                {{
                    "id": "B",
                    "label": "B",
                    "display_text": "選択肢B",
                    "value_text": "選択肢B"
                }},
                {{
                    "id": "C",
                    "label": "C",
                    "display_text": "選択肢C",
                    "value_text": "選択肢C"
                }},
                {{
                    "id": "D",
                    "label": "D",
                    "display_text": "選択肢D",
                    "value_text": "選択肢D"
                }}
            ],

            "answer": {{
                "display_text": "正答の表示内容",
                "canonical_text": "正答の内部表現",
                "accepted_variants": [],
                "correct_choice_id": "A"
            }},

            "solution": {{
                "text": "解法の説明。数式は必要なら $...$ や $$...$$ を使う",
                "math_format": "markdown_latex"
            }},

            "input_hints": {{
                "preferred_mode": "choice",
                "template_keys": [],
                "allow_handwritten_image": false
            }},

            "grading": {{
                "equivalence_mode": "exact",
                "accept_choice_labels": true,
                "accept_choice_indices": true,
                "keywords": []
            }},

            "question_text": "既存互換用の問題文",
            "options": ["既存互換用の選択肢A", "既存互換用の選択肢B", "既存互換用の選択肢C", "既存互換用の選択肢D"],
            "correct_answer": "既存互換用の正答",
            "solution_text": "既存互換用の解法の説明"
    }}
  ]
}}
```

整合性ルール:
- prompt.text と question_text は同じ内容にする
- free_text では answer.display_text を correct_answer に入れる
- multiple_choice では answer.display_text と choices の正答 display_text を一致させ、correct_answer にも同じ内容を入れる
- multiple_choice の options は choices の display_text だけを順番通りに並べる
- solution.text と solution_text は同じ内容にする
- JSON以外の説明文は一切出力しない
"""

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=_build_config(
            system_instruction=(
                "あなたは数学の演習問題作成者です。"
                "指定のJSON形式のみを出力してください。"
            )
        ),
    )
    return response.text or ""


async def grade_practice_answer(
    problem_payload: dict[str, Any],
    submission: dict[str, str],
) -> str:
    """回答を採点し、スコアと詳細フィードバックをJSONで返す。"""
    client = _get_client()
    
    # working_steps の処理：画像の場合はOCR認識
    working_steps = submission.get("working_steps", "").strip()
    if working_steps.startswith("data:image"):
        recognized_text = await _recognize_handwriting_image(working_steps)
        # OCRに失敗した場合は採点本文へ失敗メッセージを混ぜず、途中式なしとして扱う。
        working_steps = recognized_text or "(なし)"
    else:
        working_steps = working_steps or "(なし)"
    
    final_answer = submission.get("final_answer", "").strip() or "(未記入)"
    combined_answer = submission.get("user_answer", "").strip() or "(なし)"

    prompt = (
        "以下の問題に対する学習者の回答を採点してください。\n\n"
        f"問題データ:\n{problem_payload}\n\n"
        f"学習者の途中式:\n{working_steps}\n\n"
        f"学習者の最終解答:\n{final_answer}\n\n"
        f"学習者の提出全文:\n{combined_answer}\n\n"
        "採点ルール:\n"
        "- score は 0 から 100 の整数\n"
        "- is_correct は score が 80 以上なら true\n"
        "- problem_payload.answer.canonical_text を採点の中心に使う\n"
        "- 最終解答の評価は、学習者の最終解答を最優先で判定する\n"
        "- 途中式がある場合は、概念理解と計算過程の評価に反映する\n"
        "- 途中式がない場合は、concept と calculation の detail に「途中式不足で評価が限定的」と明記する\n"
        "- problem_payload.answer.accepted_variants にある表現は正答として扱う\n"
        "- problem_payload.grading.equivalence_mode が exact の場合は表記一致を優先する\n"
        "- problem_payload.grading.equivalence_mode が symbolic の場合は数式の等価性を優先する\n"
        "- problem_payload.grading.equivalence_mode が ai の場合は文脈と説明の妥当性も見て判断する\n"
        "- problem_payload.grading.equivalence_mode が symbolic_or_ai の場合は、まず数式等価性を見て、不足時のみ文脈判断を補助的に使う\n"
        "- multiple_choice では problem_payload.answer.correct_choice_id と choices を優先し、表示文言の揺れに引きずられない\n"
        "- 部分点を与える場合は理由を明確にする\n"
        "- problem_payload.grading.keywords がある場合は、解答や説明にその観点が含まれているかも考慮する\n"
        "- 日本語で、学習者が次に改善できるフィードバックにする\n\n"
        "次のJSONのみを返してください:\n"
        "```json\n"
        "{\n"
        "  \"score\": 0,\n"
        "  \"is_correct\": false,\n"
        "  \"feedback\": \"学習者向けの詳細フィードバック\",\n"
        "  \"mistake_points\": [\"誤り1\", \"誤り2\"],\n"
        "  \"next_hint\": \"次に意識するポイント\",\n"
        "  \"rubric_scores\": {\n"
        "    \"concept\": 0,\n"
        "    \"calculation\": 0,\n"
        "    \"final_answer\": 0\n"
        "  },\n"
        "  \"mistake_summary\": {\n"
        "    \"concept\": {\n"
        "      \"title\": \"概念ミス\",\n"
        "      \"score\": 0,\n"
        "      \"has_issue\": true,\n"
        "      \"detail\": \"どの概念理解が弱かったか\"\n"
        "    },\n"
        "    \"calculation\": {\n"
        "      \"title\": \"計算ミス\",\n"
        "      \"score\": 0,\n"
        "      \"has_issue\": true,\n"
        "      \"detail\": \"どの計算処理が崩れたか\"\n"
        "    },\n"
        "    \"final_answer\": {\n"
        "      \"title\": \"最終答ミス\",\n"
        "      \"score\": 0,\n"
        "      \"has_issue\": true,\n"
        "      \"detail\": \"最終答のどこがずれているか\"\n"
        "    }\n"
        "  },\n"
        "  \"equivalence_note\": \"等価判定の理由\"\n"
        "}\n"
        "```\n"
    )

    response = client.models.generate_content(
        model=MODEL_NAME,
        contents=prompt,
        config=_build_config(
            system_instruction=(
                "あなたは数学教師です。"
                "JSON形式のみを返し、採点は厳密かつ教育的に行ってください。"
            )
        ),
    )
    return response.text or ""
