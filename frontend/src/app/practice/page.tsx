"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { useSearchParams } from "next/navigation";
import ReactMarkdown from "react-markdown";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import { HiChevronDown, HiOutlinePhoto, HiOutlineTrash } from "react-icons/hi2";

import { HandwritingCanvas } from "@/components/HandwritingCanvas";
import {
  createNote,
  deletePracticeProblem,
  deletePracticeProblems,
  extractPracticeAnswerImage,
  generatePracticeProblems,
  getCurriculum,
  getPracticeStats,
  listPracticeAttempts,
  listPracticeProblems,
  submitPracticeAttempt,
  type PracticeAttempt,
  type PracticeProblem,
  type PracticeStats,
  type Unit,
} from "@/lib/api";
import { useScrollRestoration } from "@/lib/pagePersistence";

type Difficulty = "easy" | "medium" | "hard";
type Tab = "generate" | "saved";
type ToastState = {
  message: string;
};
type PendingExtraction = {
  problemId: number;
  isSaved: boolean;
  extractedText: string;
};
type PendingCrop = {
  problemId: number;
  isSaved: boolean;
  file: File;
  objectUrl: string;
};
type AnswerField = "workingSteps" | "finalAnswer";
type AnswerDraft = {
  workingSteps: string;
  finalAnswer: string;
};
type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};
type CropHandle = "nw" | "ne" | "sw" | "se";

type PersistedPracticeState = {
  selectedTopicId: number | null;
  difficulty: Difficulty;
  count: number;
  activeTab: Tab;
  problems: PracticeProblem[];
  answers: Record<number, AnswerDraft>;
  attempts: Record<number, PracticeAttempt>;
  stats: PracticeStats | null;
  savedProblems: PracticeProblem[];
  savedAnswers: Record<number, AnswerDraft>;
  savedAttempts: Record<number, PracticeAttempt>;
  attemptHistoryMap: Record<number, PracticeAttempt[]>;
  retryingIds: number[];
};

const MIN_CROP_SIZE = 12;
const PRACTICE_PAGE_STATE_KEY = "practice-page-state-v1";

const difficultyLabels: Record<Difficulty, string> = {
  easy: "やさしい",
  medium: "標準",
  hard: "難しい",
};

const mathTemplates = [
  { label: "分数", template: "\\frac{{cursor}}{}" },
  { label: "微分", template: "\\frac{d}{dx}({{cursor}})" },
  { label: "偏微分", template: "\\frac{\\partial {{cursor}}}{\\partial x}" },
  { label: "積分", template: "\\int {{cursor}} \\, dx" },
  { label: "定積分", template: "\\int_{a}^{b} {{cursor}} \\, dx" },
  { label: "極限", template: "\\lim_{x \\to a} {{cursor}}" },
  { label: "総和", template: "\\sum_{n=1}^{N} {{cursor}}" },
  { label: "平方根", template: "\\sqrt{{cursor}}" },
  { label: "n乗根", template: "\\sqrt[n]{{cursor}}" },
  { label: "絶対値", template: "\\left| {{cursor}} \\right|" },
  { label: "ベクトル", template: "\\vec{{cursor}}" },
  { label: "行列", template: "\\begin{pmatrix} {{cursor}} \\end{pmatrix}" },
  { label: "三角関数", template: "\\sin({{cursor}})" },
  { label: "対数", template: "\\log({{cursor}})" },
  { label: "指数", template: "e^{{cursor}}" },
  { label: "括弧", template: "({{cursor}})" },
] as const;

function renderMarkdown(content: string) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-1 prose-headings:my-2 prose-ul:my-1 prose-ol:my-1 prose-li:my-0.5">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function renderCompactMarkdown(content: string) {
  return (
    <div className="prose prose-sm max-w-none prose-p:my-0 prose-headings:my-0 prose-ul:my-0 prose-ol:my-0 prose-li:my-0">
      <ReactMarkdown remarkPlugins={[remarkMath]} rehypePlugins={[rehypeKatex]}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

function formatScore(value: number | null | undefined, fallback = 0) {
  const normalized = Number.isFinite(value) ? Number(value) : fallback;
  return normalized.toFixed(2).replace(/\.00$/, "").replace(/(\.\d)0$/, "$1");
}

function normalizePracticeProblem(problem: PracticeProblem): PracticeProblem {
  return {
    ...problem,
    best_score: Number.isFinite(problem.best_score) ? Number(problem.best_score) : 0,
    max_score: Number.isFinite(problem.max_score) && problem.max_score > 0 ? Number(problem.max_score) : 100,
  };
}

function normalizePracticeAttempt(attempt: PracticeAttempt): PracticeAttempt {
  return {
    ...attempt,
    score: Number.isFinite(attempt.score) ? Number(attempt.score) : 0,
    max_score: Number.isFinite(attempt.max_score) && attempt.max_score > 0 ? Number(attempt.max_score) : 100,
  };
}

function normalizeAttemptRecord(record: Record<number, PracticeAttempt>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [Number(key), normalizePracticeAttempt(value)])
  ) as Record<number, PracticeAttempt>;
}

function normalizeHistoryMap(record: Record<number, PracticeAttempt[]>) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [
      Number(key),
      Array.isArray(value) ? value.map((entry) => normalizePracticeAttempt(entry)) : [],
    ])
  ) as Record<number, PracticeAttempt[]>;
}

function readPersistedPracticeState(): PersistedPracticeState | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(PRACTICE_PAGE_STATE_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<PersistedPracticeState>;
    return {
      selectedTopicId:
        typeof parsed.selectedTopicId === "number" ? parsed.selectedTopicId : null,
      difficulty:
        parsed.difficulty === "easy" || parsed.difficulty === "medium" || parsed.difficulty === "hard"
          ? parsed.difficulty
          : "medium",
      count:
        typeof parsed.count === "number" && parsed.count >= 1 && parsed.count <= 10
          ? parsed.count
          : 3,
      activeTab: parsed.activeTab === "saved" ? "saved" : "generate",
      problems: Array.isArray(parsed.problems)
        ? parsed.problems.map((problem) => normalizePracticeProblem(problem))
        : [],
      answers: parsed.answers ?? {},
      attempts: normalizeAttemptRecord(parsed.attempts ?? {}),
      stats: parsed.stats ?? null,
      savedProblems: Array.isArray(parsed.savedProblems)
        ? parsed.savedProblems.map((problem) => normalizePracticeProblem(problem))
        : [],
      savedAnswers: parsed.savedAnswers ?? {},
      savedAttempts: normalizeAttemptRecord(parsed.savedAttempts ?? {}),
      attemptHistoryMap: normalizeHistoryMap(parsed.attemptHistoryMap ?? {}),
      retryingIds: Array.isArray(parsed.retryingIds)
        ? parsed.retryingIds.filter((value): value is number => typeof value === "number")
        : [],
    };
  } catch {
    return null;
  }
}

function toPlainMathLikeExpression(input: string) {
  let text = input;
  text = text.replace(/→/g, "->");
  text = text.replace(/\bdy\s*\/\s*dx\b/gi, "\\\\frac{dy}{dx}");
  text = text.replace(/\bd\s*\/\s*d\s*x\b/gi, "\\\\frac{d}{dx}");
  text = text.replace(/\bint\b/gi, "\\\\int");
  text = text.replace(/\blim\s*([a-zA-Z])\s*(?:->)\s*([a-zA-Z0-9+\-]+)/gi, "\\\\lim_{$1 \\\\to $2}");
  text = text.replace(/\bsqrt\s*\(([^\n)]+)\)/gi, "\\\\sqrt{$1}");
  text = text.replace(/\bsqrt\s+([a-zA-Z0-9]+)/gi, "\\\\sqrt{$1}");
  text = text.replace(/\b(sin|cos|tan|log|ln|exp)\s*\(/gi, "\\\\$1(");
  text = text.replace(/\b([a-zA-Z])\s*\^\s*([0-9]+)/g, "$1^{$2}");
  text = text.replace(/\b([a-zA-Z])\s*_\s*([0-9]+)/g, "$1_{$2}");
  text = text.replace(/(\\\\int[^\n]*?)\s+d([a-zA-Z])\b/g, "$1 \\\\, d$2");
  return text;
}

function looksLikePlainMathLine(line: string) {
  const t = line.trim();
  if (!t) return false;
  if (t.includes("$") || t.includes("\\\\")) return false;
  const hasJapanese = /[\u3040-\u30ff\u4e00-\u9faf]/.test(t);
  if (hasJapanese) return false;
  return /\d|=|\+|-|\*|\/|\^|\(|\)|dy\s*\/\s*dx|d\s*\/\s*d\s*x|\bint\b|\blim\b|\bsqrt\b/i.test(t);
}

function wrapInlineMathFragments(line: string) {
  if (!line.trim() || line.includes("$")) return line;

  const applyInlineMathPattern = (text: string, pattern: RegExp) =>
    text.replace(pattern, (match, ...args) => {
      const offset = args[args.length - 2] as number;
      const source = args[args.length - 1] as string;
      const beforeChar = source[offset - 1];
      const afterChar = source[offset + match.length];
      const trimmed = match.trim();

      if (!trimmed) return match;
      if (beforeChar === "$" || afterChar === "$") return match;

      return match.replace(trimmed, `$${toPlainMathLikeExpression(trimmed)}$`);
    });

  const patterns = [
    /\bdy\s*\/\s*dx\b/gi,
    /\bd\s*\/\s*d\s*x\b/gi,
    /\blim\s*[a-zA-Z]\s*->\s*[A-Za-z0-9+\-]+\b/gi,
    /\bint\s+[^。、，,\n]+?\s+d[a-zA-Z]\b/gi,
    /\bsqrt\s*(?:\([^)]+\)|[A-Za-z0-9]+)/gi,
    /\b(?:sin|cos|tan|log|ln|exp)\s*\([^)]+\)/gi,
    /\b[a-zA-Z][a-zA-Z0-9]*\([^\n)]*\)\s*=\s*[^。、，,\n]+/g,
    /\b(?:\d*[a-zA-Z]{1,2}(?:\s*[+\-*/=]\s*(?:\d*[a-zA-Z]{1,2}|\d+)){1,}|\d+\s*[+\-*/=]\s*\d*[a-zA-Z]{1,2}(?:\s*[+\-*/=]\s*(?:\d*[a-zA-Z]{1,2}|\d+))*)\b/g,
    /\b[a-zA-Z]\s*\^\s*\d+\b/g,
    /\b[a-zA-Z]\s*_\s*\d+\b/g,
  ];

  let text = line;
  for (const pattern of patterns) {
    text = applyInlineMathPattern(text, pattern);
  }
  return text;
}

function toPreviewMarkdown(input: string) {
  return input
    .split("\n")
    .map((line) => {
      if (!looksLikePlainMathLine(line)) return line;
      const converted = toPlainMathLikeExpression(line.trim());
      return `$${converted}$`;
    })
    .map((line) => wrapInlineMathFragments(line))
    .join("\n");
}

function getProblemPromptText(problem: PracticeProblem) {
  return problem.prompt?.text?.trim() || problem.question_text;
}

function getProblemChoices(problem: PracticeProblem) {
  if (problem.choices?.length) {
    return problem.choices.map((choice) => ({
      key: choice.id,
      displayText: choice.display_text,
      value: choice.value_text || choice.display_text,
    }));
  }

  return (problem.options ?? []).map((option, index) => ({
    key: String(index),
    displayText: option,
    value: option,
  }));
}

function getProblemAnswerText(problem: PracticeProblem) {
  return problem.answer?.display_text?.trim() || problem.correct_answer;
}

function getProblemSolutionText(problem: PracticeProblem) {
  return problem.solution?.text?.trim() || problem.solution_text || "(解説なし)";
}

function renderSchemaDebugInfo(problem: PracticeProblem) {
  const canonicalText = problem.answer?.canonical_text?.trim() || problem.correct_answer;
  const variants = problem.answer?.accepted_variants?.filter((item) => item.trim()) ?? [];
  const keywords = problem.grading?.keywords?.filter((item) => item.trim()) ?? [];
  const correctChoiceId = problem.answer?.correct_choice_id?.trim();

  return (
    <details className="rounded-lg border border-card-border bg-background p-3 text-sm text-text-secondary">
      <summary className="cursor-pointer select-none font-medium">採点設定を確認</summary>
      <div className="mt-3 space-y-3">
        <div>
          <p className="text-xs font-medium text-text-secondary">equivalence_mode</p>
          <p className="mt-1 text-sm text-text">{problem.grading?.equivalence_mode ?? "ai"}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-text-secondary">canonical_text</p>
          <div className="mt-1 text-text">{renderCompactMarkdown(canonicalText)}</div>
        </div>

        {problem.question_type === "multiple_choice" && correctChoiceId && (
          <div>
            <p className="text-xs font-medium text-text-secondary">correct_choice_id</p>
            <p className="mt-1 text-sm text-text">{correctChoiceId}</p>
          </div>
        )}

        <div>
          <p className="text-xs font-medium text-text-secondary">accepted_variants</p>
          {variants.length > 0 ? (
            <div className="mt-2 space-y-2">
              {variants.map((variant, index) => (
                <div key={`${problem.id}-variant-${index}`} className="rounded-md border border-card-border bg-card px-3 py-2 text-text">
                  {renderCompactMarkdown(variant)}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-muted">なし</p>
          )}
        </div>

        <div>
          <p className="text-xs font-medium text-text-secondary">keywords</p>
          {keywords.length > 0 ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {keywords.map((keyword) => (
                <span
                  key={`${problem.id}-${keyword}`}
                  className="rounded-full border border-card-border bg-card px-2 py-1 text-xs text-text"
                >
                  {keyword}
                </span>
              ))}
            </div>
          ) : (
            <p className="mt-1 text-xs text-text-muted">なし</p>
          )}
        </div>
      </div>
    </details>
  );
}

function createEmptyAnswerDraft(): AnswerDraft {
  return {
    workingSteps: "",
    finalAnswer: "",
  };
}

function getAnswerDraft(
  answerMap: Record<number, AnswerDraft>,
  problemId: number,
) {
  return answerMap[problemId] ?? createEmptyAnswerDraft();
}

function buildSubmissionText(draft: AnswerDraft) {
  const parts: string[] = [];

  if (draft.workingSteps.trim()) {
    parts.push("途中式:");
    if (draft.workingSteps.startsWith('data:image')) {
      parts.push("[手書き画像画像]");
    } else {
      parts.push(draft.workingSteps.trim());
    }
  }

  if (draft.finalAnswer.trim()) {
    if (parts.length > 0) {
      parts.push("");
      parts.push("最終解答:");
      parts.push(draft.finalAnswer.trim());
    } else {
      parts.push(draft.finalAnswer.trim());
    }
  }

  return parts.join("\n");
}

function renderAttemptBreakdown(attempt: PracticeAttempt) {
  const maxScore = Number.isFinite(attempt.max_score) && attempt.max_score > 0 ? attempt.max_score : 100;
  const derivedRubricScore =
    maxScore > 0 ? Math.round((attempt.score / maxScore) * 100) : attempt.is_correct ? 100 : 0;
  const rubric = attempt.rubric_scores ?? {
    concept: derivedRubricScore,
    calculation: derivedRubricScore,
    final_answer: derivedRubricScore,
  };

  const summary = attempt.mistake_summary;

  const items = [
    summary?.concept ?? {
      title: "概念ミス",
      score: rubric.concept,
      has_issue: rubric.concept < 80,
      detail:
        rubric.concept < 80
          ? "概念理解に改善の余地があります。"
          : "概念理解は良好です。",
    },
    summary?.calculation ?? {
      title: "計算ミス",
      score: rubric.calculation,
      has_issue: rubric.calculation < 80,
      detail:
        rubric.calculation < 80
          ? "計算過程に見直しポイントがあります。"
          : "計算過程は安定しています。",
    },
    summary?.final_answer ?? {
      title: "最終答ミス",
      score: rubric.final_answer,
      has_issue: rubric.final_answer < 80,
      detail:
        rubric.final_answer < 80
          ? "最終解答の一致を再確認しましょう。"
          : "最終解答は適切です。",
    },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-3">
      {items.map((item) => {
        const toneClass = item.has_issue
          ? "border-warning bg-warning-light/40"
          : "border-success bg-success-light/30";
        const markerClass = item.has_issue ? "text-warning" : "text-text-muted";

        return (
          <section key={item.title} className={`rounded-lg border p-3 ${toneClass}`}>
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-semibold text-text">{item.title}</p>
              <span className={`text-lg font-bold leading-none ${markerClass}`} aria-label={item.has_issue ? "該当" : "非該当"}>
                {item.has_issue ? "○" : "-"}
              </span>
            </div>
            <p className="mt-2 text-sm text-text-secondary">{item.detail}</p>
          </section>
        );
      })}
    </div>
  );
}

export default function PracticePage() {
  const searchParams = useSearchParams();
  const [persistedState] = useState<PersistedPracticeState | null>(() => readPersistedPracticeState());
  const skipInitialSavedReloadRef = useRef(
    Boolean(persistedState && persistedState.activeTab === "saved")
  );
  const hasHydratedPersistenceRef = useRef(false);
  const [units, setUnits] = useState<Unit[]>([]);
  const [selectedTopicId, setSelectedTopicId] = useState<number | null>(
    persistedState?.selectedTopicId ?? null
  );
  const [difficulty, setDifficulty] = useState<Difficulty>(
    persistedState?.difficulty ?? "medium"
  );
  const [count, setCount] = useState<number>(persistedState?.count ?? 3);
  const [activeTab, setActiveTab] = useState<Tab>(
    persistedState?.activeTab ?? "generate"
  );

  useScrollRestoration(
    "practice.page.generate",
    "[data-app-scroll-root]",
    activeTab === "generate"
  );

  useScrollRestoration(
    "practice.page.saved",
    "[data-app-scroll-root]",
    activeTab === "saved"
  );

  // Generate tab state
  const [problems, setProblems] = useState<PracticeProblem[]>(
    persistedState?.problems ?? []
  );
  const [answers, setAnswers] = useState<Record<number, AnswerDraft>>(
    persistedState?.answers ?? {}
  );
  const [attempts, setAttempts] = useState<Record<number, PracticeAttempt>>(
    persistedState?.attempts ?? {}
  );
  const [stats, setStats] = useState<PracticeStats | null>(
    persistedState?.stats ?? null
  );

  // Saved problems tab state
  const [savedProblems, setSavedProblems] = useState<PracticeProblem[]>(
    persistedState?.savedProblems ?? []
  );
  const [savedAnswers, setSavedAnswers] = useState<Record<number, AnswerDraft>>(
    persistedState?.savedAnswers ?? {}
  );
  const [savedAttempts, setSavedAttempts] = useState<Record<number, PracticeAttempt>>(
    persistedState?.savedAttempts ?? {}
  );
  const [attemptHistoryMap, setAttemptHistoryMap] = useState<Record<number, PracticeAttempt[]>>(
    persistedState?.attemptHistoryMap ?? {}
  );
  const [loadingHistoryIds, setLoadingHistoryIds] = useState<Set<number>>(new Set());
  const [retryingIds, setRetryingIds] = useState<Set<number>>(
    new Set(persistedState?.retryingIds ?? [])
  );

  const [isLoadingCurriculum, setIsLoadingCurriculum] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoadingSaved, setIsLoadingSaved] = useState(false);
  const [submittingIds, setSubmittingIds] = useState<Set<number>>(new Set());
  const [savingNoteIds, setSavingNoteIds] = useState<Set<number>>(new Set());
  const [errorMessage, setErrorMessage] = useState<string>("");
  const [toast, setToast] = useState<ToastState | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [bulkDeleteTopicId, setBulkDeleteTopicId] = useState<number | null>(null);
  const [collapsedWorkingStepIds, setCollapsedWorkingStepIds] = useState<Set<number>>(new Set());
  const [extractingIds, setExtractingIds] = useState<Set<number>>(new Set());
  const [extractionMessages, setExtractionMessages] = useState<Record<number, string>>({});
  const [pendingExtraction, setPendingExtraction] = useState<PendingExtraction | null>(null);
  const [pendingCrop, setPendingCrop] = useState<PendingCrop | null>(null);
  const [cropRect, setCropRect] = useState<CropRect | null>(null);
  const finalAnswerInputRefs = useRef<Record<number, HTMLTextAreaElement | null>>({});
  const activeAnswerFieldRef = useRef<Record<number, AnswerField>>({});
  const canvasStateRef = useRef<Record<number, boolean>>({});
  const answerImageInputRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const cropStageRef = useRef<HTMLDivElement | null>(null);
  const cropImageRef = useRef<HTMLImageElement | null>(null);
  const cropDragStartRef = useRef<{ x: number; y: number } | null>(null);
  const cropResizeStateRef = useRef<{
    handle: CropHandle;
    startPoint: { x: number; y: number };
    startRect: CropRect;
  } | null>(null);

  const topics = useMemo(() => {
    const list: Array<{ id: number; label: string }> = [];
    for (const unit of units) {
      for (const section of unit.sections) {
        for (const topic of section.topics) {
          list.push({
            id: topic.id,
            label: `${unit.title} / ${section.title} / ${topic.title}`,
          });
        }
      }
    }
    return list;
  }, [units]);

  const topicLabelMap = useMemo(() => {
    return new Map(topics.map((topic) => [topic.id, topic.label]));
  }, [topics]);

  const requestedTopicId = useMemo(() => {
    const raw = searchParams.get("topicId");
    if (!raw) return null;
    const parsed = Number(raw);
    return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
  }, [searchParams]);

  const groupedSavedProblems = useMemo(() => {
    const groups = new Map<
      number,
      { topicId: number; topicLabel: string; problems: PracticeProblem[] }
    >();

    for (const problem of savedProblems) {
      const existing = groups.get(problem.topic_id);
      if (existing) {
        existing.problems.push(problem);
        continue;
      }

      groups.set(problem.topic_id, {
        topicId: problem.topic_id,
        topicLabel: topicLabelMap.get(problem.topic_id) ?? `トピック ${problem.topic_id}`,
        problems: [problem],
      });
    }

    return Array.from(groups.values()).sort((a, b) => {
      if (a.topicId === selectedTopicId) return -1;
      if (b.topicId === selectedTopicId) return 1;
      return a.topicLabel.localeCompare(b.topicLabel, "ja");
    });
  }, [savedProblems, selectedTopicId, topicLabelMap]);

  const weaknessSummary = useMemo(() => {
    const allAttempts = [
      ...Object.values(attempts),
      ...Object.values(savedAttempts),
    ];

    const summary = {
      total: allAttempts.length,
      concept: 0,
      calculation: 0,
      finalAnswer: 0,
    };

    for (const item of allAttempts) {
      if (item.mistake_summary?.concept?.has_issue) summary.concept += 1;
      if (item.mistake_summary?.calculation?.has_issue) summary.calculation += 1;
      if (item.mistake_summary?.final_answer?.has_issue) summary.finalAnswer += 1;
    }

    return summary;
  }, [attempts, savedAttempts]);

  useEffect(() => {
    if (!hasHydratedPersistenceRef.current) {
      hasHydratedPersistenceRef.current = true;
      return;
    }

    if (typeof window === "undefined") {
      return;
    }

    const snapshot: PersistedPracticeState = {
      selectedTopicId,
      difficulty,
      count,
      activeTab,
      problems,
      answers,
      attempts,
      stats,
      savedProblems,
      savedAnswers,
      savedAttempts,
      attemptHistoryMap,
      retryingIds: Array.from(retryingIds),
    };

    window.sessionStorage.setItem(PRACTICE_PAGE_STATE_KEY, JSON.stringify(snapshot));
  }, [
    selectedTopicId,
    difficulty,
    count,
    activeTab,
    problems,
    answers,
    attempts,
    stats,
    savedProblems,
    savedAnswers,
    savedAttempts,
    attemptHistoryMap,
    retryingIds,
  ]);

  useEffect(() => {
    let cancelled = false;
    setIsLoadingCurriculum(true);
    setErrorMessage("");

    async function load() {
      try {
        const data = await getCurriculum();
        if (cancelled) return;
        setUnits(data);

        const firstTopicId = data[0]?.sections[0]?.topics[0]?.id;
        if (firstTopicId) {
          setSelectedTopicId((prev) => prev ?? firstTopicId);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "カリキュラムの読み込みに失敗しました。"
          );
        }
      } finally {
        if (!cancelled) {
          setIsLoadingCurriculum(false);
        }
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!requestedTopicId) {
      return;
    }
    if (!topics.some((topic) => topic.id === requestedTopicId)) {
      return;
    }
    setSelectedTopicId(requestedTopicId);
  }, [requestedTopicId, topics]);

  useEffect(() => {
    if (!selectedTopicId) {
      setStats(null);
      return;
    }
    const topicId = selectedTopicId;

    let cancelled = false;
    setErrorMessage("");

    async function loadStats() {
      try {
        const s = await getPracticeStats(topicId);
        if (!cancelled) {
          setStats(s);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(
            err instanceof Error
              ? err.message
              : "統計の読み込みに失敗しました。"
          );
        }
      }
    }

    loadStats();
    return () => {
      cancelled = true;
    };
  }, [selectedTopicId]);

  useEffect(() => {
    if (!toast) return;

    const timeoutId = window.setTimeout(() => {
      setToast(null);
    }, 3200);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [toast]);

  // Load saved problems when tab switches to saved or topic changes
  useEffect(() => {
    if (activeTab !== "saved") return;
    if (skipInitialSavedReloadRef.current) {
      skipInitialSavedReloadRef.current = false;
      return;
    }
    loadSavedProblems();
  }, [activeTab, selectedTopicId]);

  async function loadSavedProblems() {
    setIsLoadingSaved(true);
    setErrorMessage("");
    try {
      const data = await listPracticeProblems();
      setSavedProblems(data);
      setAttemptHistoryMap({});
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "問題一覧の取得に失敗しました。"
      );
    } finally {
      setIsLoadingSaved(false);
    }
  }

  async function loadAttemptHistory(problemId: number, force = false) {
    if (!force && attemptHistoryMap[problemId]) {
      return;
    }
    if (loadingHistoryIds.has(problemId)) {
      return;
    }

    setLoadingHistoryIds((prev) => new Set(prev).add(problemId));
    try {
      const rows = await listPracticeAttempts(problemId, 100);
      setAttemptHistoryMap((prev) => ({
        ...prev,
        [problemId]: rows,
      }));
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "回答履歴の取得に失敗しました。"
      );
    } finally {
      setLoadingHistoryIds((prev) => {
        const next = new Set(prev);
        next.delete(problemId);
        return next;
      });
    }
  }

  async function handleGenerate() {
    const topicId = selectedTopicId;
    if (!topicId) return;
    setIsGenerating(true);
    setErrorMessage("");

    try {
      const res = await generatePracticeProblems(topicId, difficulty, count);
      setProblems(res.problems);
      setAnswers({});
      setAttempts({});
      const [s, saved] = await Promise.all([
        getPracticeStats(topicId),
        listPracticeProblems(),
      ]);
      setStats(s);
      setSavedProblems(saved);
      setToast({
        message: `${res.problems.length}問を生成に成功しました。`,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "問題生成に失敗しました。"
      );
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleSubmit(problem: PracticeProblem, isSaved = false) {
    const answerMap = isSaved ? savedAnswers : answers;
    const draft = getAnswerDraft(answerMap, problem.id);
    const workingSteps = draft.workingSteps.trim();
    const finalAnswer = draft.finalAnswer.trim();
    if (!workingSteps && !finalAnswer) {
      setErrorMessage("回答を入力してから採点してください。");
      return;
    }
    if (submittingIds.has(problem.id)) {
      return;
    }

    setErrorMessage("");
    setSubmittingIds((prev) => new Set(prev).add(problem.id));

    try {
      const attempt = await submitPracticeAttempt(problem.id, {
        userAnswer: buildSubmissionText(draft),
        workingSteps,
        finalAnswer,
      });
      if (isSaved) {
        setSavedAttempts((prev) => ({ ...prev, [problem.id]: attempt }));
        setAttemptHistoryMap((prev) => ({
          ...prev,
          [problem.id]: [attempt, ...(prev[problem.id] ?? [])],
        }));
        setSavedProblems((prev) =>
          prev.map((item) => {
            if (item.id !== problem.id) return item;
            return {
              ...item,
              attempt_count: item.attempt_count + 1,
              best_score: Math.max(item.best_score, attempt.score),
            };
          })
        );
        setRetryingIds((prev) => {
          const next = new Set(prev);
          next.delete(problem.id);
          return next;
        });
      } else {
        setAttempts((prev) => ({ ...prev, [problem.id]: attempt }));
        setAttemptHistoryMap((prev) => ({
          ...prev,
          [problem.id]: [attempt, ...(prev[problem.id] ?? [])],
        }));
      }
      if (selectedTopicId) {
        const topicId = selectedTopicId;
        const s = await getPracticeStats(topicId);
        setStats(s);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "採点に失敗しました。"
      );
    } finally {
      setSubmittingIds((prev) => {
        const next = new Set(prev);
        next.delete(problem.id);
        return next;
      });
    }
  }

  async function handleDeleteProblem(problemId: number) {
    setErrorMessage("");
    try {
      await deletePracticeProblem(problemId);
      setSavedProblems((prev) => prev.filter((p) => p.id !== problemId));
      setDeleteConfirmId(null);
      if (selectedTopicId) {
        const s = await getPracticeStats(selectedTopicId);
        setStats(s);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "削除に失敗しました。"
      );
    }
  }

  async function handleBulkDelete(topicId: number) {
    setErrorMessage("");
    try {
      await deletePracticeProblems(topicId);
      setSavedProblems((prev) => prev.filter((problem) => problem.topic_id !== topicId));
      setBulkDeleteTopicId(null);
      if (selectedTopicId === topicId) {
        const s = await getPracticeStats(selectedTopicId);
        setStats(s);
      }
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "一括削除に失敗しました。"
      );
    }
  }

  function buildPracticeReviewImageData(
    title: string,
    lines: string[],
  ): string {
    const width = 1200;
    const lineHeight = 34;
    const startY = 110;
    const safeTitle = title.replace(/[<>&"]/g, "");
    const safeLines = lines.map((line) => line.replace(/[<>&"]/g, ""));
    const height = Math.max(320, startY + safeLines.length * lineHeight + 80);

    const textNodes = safeLines
      .map(
        (line, index) =>
          `<text x="60" y="${startY + index * lineHeight}" font-size="22" fill="#111827">${line}</text>`
      )
      .join("");

    const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <rect width="100%" height="100%" fill="#f8fafc" />
  <rect x="30" y="30" width="${width - 60}" height="${height - 60}" rx="18" fill="#ffffff" stroke="#cbd5e1" />
  <text x="60" y="75" font-size="28" font-weight="700" fill="#1d4ed8">${safeTitle}</text>
  ${textNodes}
</svg>
`.trim();

    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }

  async function handleSaveWeaknessNote(problem: PracticeProblem, attempt: PracticeAttempt) {
    if (savingNoteIds.has(problem.id)) {
      return;
    }

    const topicLabel = topicLabelMap.get(problem.topic_id) ?? `トピック ${problem.topic_id}`;
    const weakAreas = [
      attempt.mistake_summary?.concept?.has_issue ? "概念" : null,
      attempt.mistake_summary?.calculation?.has_issue ? "計算" : null,
      attempt.mistake_summary?.final_answer?.has_issue ? "最終答" : null,
    ].filter((item): item is string => Boolean(item));

    const lines: string[] = [
      `トピック: ${topicLabel}`,
      `スコア: ${formatScore(attempt.score)} / ${formatScore(attempt.max_score)} 点`,
      `結果: ${attempt.is_correct ? "正解" : "不正解"}`,
      `弱点: ${weakAreas.length > 0 ? weakAreas.join(" / ") : "特になし"}`,
    ];

    if (attempt.next_hint.trim()) {
      lines.push(`次のヒント: ${attempt.next_hint.trim()}`);
    }

    if (attempt.mistake_points?.length) {
      attempt.mistake_points.slice(0, 3).forEach((item, index) => {
        lines.push(`注意点${index + 1}: ${item}`);
      });
    }

    setSavingNoteIds((prev) => new Set(prev).add(problem.id));
    setErrorMessage("");
    try {
      const title = `演習復習: ${getProblemPromptText(problem).slice(0, 24)}`;
      const imageData = buildPracticeReviewImageData(title, lines);
      await createNote({
        title,
        category: "practice-review",
        image_data: imageData,
      });
      setToast({ message: "弱点分析をノートに保存しました。" });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "ノート保存に失敗しました。"
      );
    } finally {
      setSavingNoteIds((prev) => {
        const next = new Set(prev);
        next.delete(problem.id);
        return next;
      });
    }
  }

  function insertMathTemplate(
    problemId: number,
    template: string,
    isSaved: boolean,
  ) {
    const answerMap = isSaved ? savedAnswers : answers;
    const setAnswerMap = isSaved ? setSavedAnswers : setAnswers;
    let targetField = activeAnswerFieldRef.current[problemId] ?? "finalAnswer";
    
    // 途中式がキャンバスになったため、テンプレート挿入は最終解答のみに対応
    if (targetField === "workingSteps") {
      targetField = "finalAnswer";
    }
    
    const textarea = finalAnswerInputRefs.current[problemId];
    const currentDraft = getAnswerDraft(answerMap, problemId);
    const currentValue = currentDraft[targetField] ?? "";
    const selectionStart = textarea?.selectionStart ?? currentValue.length;
    const selectionEnd = textarea?.selectionEnd ?? currentValue.length;
    const selectedText = currentValue.slice(selectionStart, selectionEnd);
    const cursorToken = "{{cursor}}";
    const nextSnippet = template.replace(cursorToken, selectedText);
    const nextValue =
      currentValue.slice(0, selectionStart) +
      nextSnippet +
      currentValue.slice(selectionEnd);
    const nextCursor = selectionStart + nextSnippet.indexOf(selectedText || "") + nextSnippet.length;

    setAnswerMap((prev) => ({
      ...prev,
      [problemId]: {
        ...getAnswerDraft(prev, problemId),
        [targetField]: nextValue,
      },
    }));

    requestAnimationFrame(() => {
      // 途中式がキャンバスになったため、テンプレート挿入は最終解答のみ
      const nextTextarea = finalAnswerInputRefs.current[problemId];
      if (!nextTextarea) return;
      nextTextarea.focus();

      if (selectedText) {
        const end = selectionStart + nextSnippet.length;
        nextTextarea.setSelectionRange(end, end);
        return;
      }

      const placeholderIndex = template.indexOf(cursorToken);
      const cursorPosition =
        placeholderIndex >= 0 ? selectionStart + placeholderIndex : nextCursor;
      nextTextarea.setSelectionRange(cursorPosition, cursorPosition);
    });
  }

  function getStagePointFromClient(clientX: number, clientY: number) {
    const stage = cropStageRef.current;
    if (!stage) return null;
    const rect = stage.getBoundingClientRect();
    const x = Math.max(0, Math.min(rect.width, clientX - rect.left));
    const y = Math.max(0, Math.min(rect.height, clientY - rect.top));
    return { x, y };
  }

  function getStagePoint(e: React.PointerEvent<Element>) {
    return getStagePointFromClient(e.clientX, e.clientY);
  }

  function handleCropResizePointerDown(
    e: React.PointerEvent<HTMLButtonElement>,
    handle: CropHandle,
  ) {
    if (!cropRect) return;
    const point = getStagePoint(e);
    if (!point) return;
    e.preventDefault();
    e.stopPropagation();
    cropDragStartRef.current = null;
    cropResizeStateRef.current = {
      handle,
      startPoint: point,
      startRect: cropRect,
    };
  }

  function handleCropPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!pendingCrop) return;
    if (cropResizeStateRef.current) return;
    const point = getStagePoint(e);
    if (!point) return;
    cropDragStartRef.current = point;
    setCropRect({ x: point.x, y: point.y, width: 0, height: 0 });
  }

  function handleCropPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    const resizeState = cropResizeStateRef.current;
    if (resizeState) {
      const point = getStagePoint(e);
      const stage = cropStageRef.current;
      if (!point || !stage) return;

      const stageRect = stage.getBoundingClientRect();
      const stageWidth = stageRect.width;
      const stageHeight = stageRect.height;
      const { startRect, startPoint, handle } = resizeState;
      const dx = point.x - startPoint.x;
      const dy = point.y - startPoint.y;
      const startRight = startRect.x + startRect.width;
      const startBottom = startRect.y + startRect.height;

      let nextX = startRect.x;
      let nextY = startRect.y;
      let nextW = startRect.width;
      let nextH = startRect.height;

      if (handle === "nw") {
        nextX = Math.max(0, Math.min(startRight - MIN_CROP_SIZE, startRect.x + dx));
        nextY = Math.max(0, Math.min(startBottom - MIN_CROP_SIZE, startRect.y + dy));
        nextW = startRight - nextX;
        nextH = startBottom - nextY;
      } else if (handle === "ne") {
        const nextRight = Math.min(
          stageWidth,
          Math.max(startRect.x + MIN_CROP_SIZE, startRight + dx),
        );
        nextY = Math.max(0, Math.min(startBottom - MIN_CROP_SIZE, startRect.y + dy));
        nextW = nextRight - startRect.x;
        nextH = startBottom - nextY;
      } else if (handle === "sw") {
        nextX = Math.max(0, Math.min(startRight - MIN_CROP_SIZE, startRect.x + dx));
        const nextBottom = Math.min(
          stageHeight,
          Math.max(startRect.y + MIN_CROP_SIZE, startBottom + dy),
        );
        nextW = startRight - nextX;
        nextH = nextBottom - startRect.y;
      } else {
        const nextRight = Math.min(
          stageWidth,
          Math.max(startRect.x + MIN_CROP_SIZE, startRight + dx),
        );
        const nextBottom = Math.min(
          stageHeight,
          Math.max(startRect.y + MIN_CROP_SIZE, startBottom + dy),
        );
        nextW = nextRight - startRect.x;
        nextH = nextBottom - startRect.y;
      }

      setCropRect({ x: nextX, y: nextY, width: nextW, height: nextH });
      return;
    }

    const start = cropDragStartRef.current;
    if (!start) return;
    const point = getStagePoint(e);
    if (!point) return;

    const x = Math.min(start.x, point.x);
    const y = Math.min(start.y, point.y);
    const width = Math.abs(point.x - start.x);
    const height = Math.abs(point.y - start.y);
    setCropRect({ x, y, width, height });
  }

  function handleCropPointerUp() {
    cropResizeStateRef.current = null;
    const rect = cropRect;
    cropDragStartRef.current = null;
    if (!rect) return;
    if (rect.width < 8 || rect.height < 8) {
      setCropRect(null);
    }
  }

  function closePendingCrop() {
    if (pendingCrop) {
      URL.revokeObjectURL(pendingCrop.objectUrl);
    }
    setPendingCrop(null);
    setCropRect(null);
    cropDragStartRef.current = null;
    cropResizeStateRef.current = null;
  }

  function handleAnswerImageSelected(
    problemId: number,
    file: File | null,
    isSaved: boolean,
  ) {
    if (!file) return;

    if (pendingCrop) {
      URL.revokeObjectURL(pendingCrop.objectUrl);
    }

    const objectUrl = URL.createObjectURL(file);
    setPendingCrop({
      problemId,
      isSaved,
      file,
      objectUrl,
    });
    setCropRect(null);
    setExtractionMessages((prev) => ({
      ...prev,
      [problemId]: "トリミング範囲を選択してから抽出できます。",
    }));

    const input = answerImageInputRefs.current[problemId];
    if (input) {
      input.value = "";
    }
  }

  async function createCroppedFileFromPending(): Promise<File | null> {
    if (!pendingCrop) return null;
    if (!cropRect || cropRect.width < MIN_CROP_SIZE || cropRect.height < MIN_CROP_SIZE) {
      return pendingCrop.file;
    }

    const img = cropImageRef.current;
    if (!img) return pendingCrop.file;

    const displayWidth = img.clientWidth;
    const displayHeight = img.clientHeight;
    if (displayWidth <= 0 || displayHeight <= 0) {
      return pendingCrop.file;
    }

    const scaleX = img.naturalWidth / displayWidth;
    const scaleY = img.naturalHeight / displayHeight;
    const sx = Math.max(0, Math.floor(cropRect.x * scaleX));
    const sy = Math.max(0, Math.floor(cropRect.y * scaleY));
    const sw = Math.max(1, Math.floor(cropRect.width * scaleX));
    const sh = Math.max(1, Math.floor(cropRect.height * scaleY));

    const canvas = document.createElement("canvas");
    canvas.width = sw;
    canvas.height = sh;

    const ctx = canvas.getContext("2d");
    if (!ctx) return pendingCrop.file;

    ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await new Promise<Blob | null>((resolve) => {
      canvas.toBlob(resolve, pendingCrop.file.type || "image/png", 0.95);
    });

    if (!blob) return pendingCrop.file;

    const dotIndex = pendingCrop.file.name.lastIndexOf(".");
    const baseName = dotIndex >= 0 ? pendingCrop.file.name.slice(0, dotIndex) : pendingCrop.file.name;
    const ext = dotIndex >= 0 ? pendingCrop.file.name.slice(dotIndex) : ".png";
    return new File([blob], `${baseName}-crop${ext}`, {
      type: blob.type || pendingCrop.file.type,
    });
  }

  async function confirmCropAndExtract() {
    if (!pendingCrop) return;
    const target = pendingCrop;
    const fileToSend = await createCroppedFileFromPending();
    closePendingCrop();
    await handleAnswerImageUpload(target.problemId, fileToSend, target.isSaved);
  }

  async function useOriginalAndExtract() {
    if (!pendingCrop) return;
    const target = pendingCrop;
    closePendingCrop();
    await handleAnswerImageUpload(target.problemId, target.file, target.isSaved);
  }

  async function handleAnswerImageUpload(
    problemId: number,
    file: File | null,
    isSaved: boolean,
  ) {
    if (!file) return;

    setErrorMessage("");
    setExtractionMessages((prev) => ({
      ...prev,
      [problemId]: "画像を読み取っています...",
    }));
    setExtractingIds((prev) => new Set(prev).add(problemId));

    try {
      const result = await extractPracticeAnswerImage(file);
      const extracted = result.extracted_text.trim();
      setExtractionMessages((prev) => ({
        ...prev,
        [problemId]: "抽出結果を確認してください。追記または置換を選べます。",
      }));
      setPendingExtraction({
        problemId,
        isSaved,
        extractedText: extracted,
      });
    } catch (err) {
      setErrorMessage(
        err instanceof Error ? err.message : "画像の読み取りに失敗しました。"
      );
      setExtractionMessages((prev) => ({
        ...prev,
        [problemId]: "画像から数式を読み取れませんでした。明るい場所で正面から撮影した画像で再試行してください。",
      }));
    } finally {
      setExtractingIds((prev) => {
        const next = new Set(prev);
        next.delete(problemId);
        return next;
      });
      const input = answerImageInputRefs.current[problemId];
      if (input) {
        input.value = "";
      }
    }
  }

  function applyPendingExtraction(mode: "append" | "replace") {
    if (!pendingExtraction) return;

    const { problemId, isSaved, extractedText } = pendingExtraction;
    const answerMap = isSaved ? savedAnswers : answers;
    const setAnswerMap = isSaved ? setSavedAnswers : setAnswers;
    const currentDraft = getAnswerDraft(answerMap, problemId);
    const currentAnswer = currentDraft.workingSteps;
    const nextAnswer =
      mode === "replace"
        ? extractedText
        : currentAnswer.trim()
          ? `${currentAnswer.trim()}\n${extractedText}`
          : extractedText;

    setAnswerMap((prev) => ({
      ...prev,
      [problemId]: {
        ...getAnswerDraft(prev, problemId),
        workingSteps: nextAnswer,
      },
    }));
    setExtractionMessages((prev) => ({
      ...prev,
      [problemId]:
        mode === "replace"
          ? "抽出結果で最終解答欄を置き換えました。必要なら手で修正してください。"
          : "抽出結果を最終解答欄に追記しました。必要なら手で修正してください。",
    }));
    setPendingExtraction(null);

    requestAnimationFrame(() => {
      // 画像抽出後、最終解答フィールドにフォーカス
      const textarea = finalAnswerInputRefs.current[problemId];
      if (!textarea) return;
      textarea.focus();
      const end = nextAnswer.length;
      textarea.setSelectionRange(end, end);
    });
  }

  function cancelPendingExtraction() {
    if (!pendingExtraction) return;

    setExtractionMessages((prev) => ({
      ...prev,
      [pendingExtraction.problemId]: "抽出結果をキャンセルしました。",
    }));
    setPendingExtraction(null);
  }

  function renderAttemptHistory(
    p: PracticeProblem,
    history: PracticeAttempt[],
    isLoadingHistory: boolean,
  ) {
    return (
      <details className="rounded-lg border border-card-border bg-background p-3">
        <summary
          className="cursor-pointer select-none text-sm font-medium text-text-secondary"
          onClick={() => {
            if (!attemptHistoryMap[p.id]) {
              void loadAttemptHistory(p.id);
            }
          }}
        >
          回答履歴を表示（新しい順）
        </summary>
        <div className="mt-3 space-y-2">
          {isLoadingHistory ? (
            <p className="text-sm text-text-muted">履歴を読み込み中...</p>
          ) : history.length === 0 ? (
            <p className="text-sm text-text-muted">回答履歴はまだありません。</p>
          ) : (
            history.map((row, historyIdx) => {
              const resultTone = row.is_correct
                ? "bg-success-light/30 text-success border-success"
                : "bg-error-light text-error border-error";
              return (
                <section
                  key={`history-${row.id}-${historyIdx}`}
                  className="rounded-lg border border-card-border bg-card p-3 space-y-2"
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-xs text-text-muted">
                      {new Date(row.submitted_at).toLocaleString("ja-JP")}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-xs font-semibold ${resultTone}`}>
                        {row.is_correct ? "正解" : "不正解"}
                      </span>
                      <span className="text-xs font-semibold text-text-secondary">
                        {formatScore(row.score)} / {formatScore(row.max_score)}点
                      </span>
                    </div>
                  </div>

                  {p.question_type === "free_text" && row.working_steps.trim() && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-text-secondary">途中式</p>
                      {row.working_steps.startsWith("data:image") ? (
                        <Image
                          src={row.working_steps}
                          alt="保存された途中式"
                          width={960}
                          height={540}
                          unoptimized
                          className="max-w-full h-auto rounded border border-card-border"
                        />
                      ) : (
                        <div className="text-sm text-text">{renderMarkdown(toPreviewMarkdown(row.working_steps))}</div>
                      )}
                    </div>
                  )}

                  {row.final_answer.trim() && (
                    <div className="space-y-1">
                      <p className="text-xs font-medium text-text-secondary">最終解答</p>
                      <div className="text-sm text-text">{renderMarkdown(toPreviewMarkdown(row.final_answer))}</div>
                    </div>
                  )}

                  {(row.feedback || (row.mistake_points ?? []).length > 0 || row.next_hint) && (
                    <details className="rounded border border-card-border bg-background p-2">
                      <summary className="cursor-pointer select-none text-xs font-medium text-text-secondary">
                        採点詳細・弱点分析を表示
                      </summary>
                      <div className="mt-2 space-y-3">
                        {row.feedback && (
                          <div className="text-sm text-text">{renderMarkdown(row.feedback)}</div>
                        )}
                        {renderAttemptBreakdown(row)}
                        {(row.mistake_points ?? []).length > 0 && (
                          <ul className="list-disc pl-5 text-sm text-warning space-y-0.5">
                            {(row.mistake_points ?? []).map((m, i) => (
                              <li key={`hist-mp-${row.id}-${i}`}>{m}</li>
                            ))}
                          </ul>
                        )}
                        {row.next_hint && (
                          <p className="text-sm text-primary">ヒント: {row.next_hint}</p>
                        )}
                      </div>
                    </details>
                  )}
                </section>
              );
            })
          )}
        </div>
      </details>
    );
  }

  function renderProblemCard(
    p: PracticeProblem,
    idx: number,
    isSaved: boolean,
  ) {
    const attemptMap = isSaved ? savedAttempts : attempts;
    const answerMap = isSaved ? savedAnswers : answers;
    const setAnswerMap = isSaved ? setSavedAnswers : setAnswers;
    const attempt = attemptMap[p.id];
    const history = attemptHistoryMap[p.id] ?? [];
    const isLoadingHistory = loadingHistoryIds.has(p.id);
    const isSubmitting = submittingIds.has(p.id);
    const currentDraft = getAnswerDraft(answerMap, p.id);
    const currentAnswer = currentDraft.finalAnswer;
    const isRetrying = retryingIds.has(p.id);
    const isExtracting = extractingIds.has(p.id);
    const isSavingNote = savingNoteIds.has(p.id);
    const isWorkingStepsCollapsed = collapsedWorkingStepIds.has(p.id);
    const extractionMessage = extractionMessages[p.id];
    const promptText = getProblemPromptText(p);
    const choiceItems = getProblemChoices(p);
    const answerText = getProblemAnswerText(p);
    const solutionText = getProblemSolutionText(p);
    const attemptStatusTitle = attempt?.is_correct ? "正解です" : "不正解です";
    const attemptStatusClass = attempt?.is_correct ? "text-success" : "text-error";
    const attemptCardClass = attempt?.is_correct
      ? "border-success bg-success-light/50"
      : "border-error bg-error-light/50";
    const savedArticleClass = attempt
      ? attempt.is_correct
        ? "border-success bg-success-light/20"
        : "border-error bg-error-light/20"
      : "border-card-border bg-card";

    // For saved problems: show summary unless retrying
    if (isSaved && !isRetrying) {
      return (
        <article key={p.id} className={`border rounded-xl p-5 space-y-3 ${savedArticleClass}`}>
          <header className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-text">問題 {idx + 1}</h2>
            <div className="flex items-center gap-2">
              <span className="text-xs px-2 py-1 rounded-full bg-background text-text-secondary">
                {p.question_type === "multiple_choice" ? "四択" : "記述式"} / {difficultyLabels[p.difficulty]}
              </span>
              {p.attempt_count > 0 && (
                <span className="text-xs px-2 py-1 rounded-full bg-primary-light text-primary">
                  回答{p.attempt_count}回 / 最高{formatScore(p.best_score)} / {formatScore(p.max_score)}点
                </span>
              )}
              {deleteConfirmId === p.id ? (
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => handleDeleteProblem(p.id)}
                    className="text-xs px-2 py-1 bg-error text-white rounded-lg hover:opacity-80"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="text-xs px-2 py-1 bg-background text-text-secondary rounded-lg hover:bg-hover"
                  >
                    取消
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(p.id)}
                  className="p-1 text-text-muted hover:text-error transition-colors"
                  title="削除"
                >
                  <HiOutlineTrash className="w-4 h-4" />
                </button>
              )}
            </div>
          </header>

          <div className="text-text">{renderMarkdown(promptText)}</div>

          {attempt && (
            <div className={`rounded-lg border px-3 py-2 ${attemptCardClass}`}>
              <p className={`text-lg font-bold ${attemptStatusClass}`}>{attemptStatusTitle}</p>
              <p className="mt-1 text-sm font-semibold text-text">
                スコア: {formatScore(attempt.score)} / {formatScore(attempt.max_score)}点 {attempt.is_correct ? "(採点結果: 正解)" : "(採点結果: 不正解)"}
              </p>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setRetryingIds((prev) => new Set(prev).add(p.id));
                setSavedAnswers((prev) => ({ ...prev, [p.id]: createEmptyAnswerDraft() }));
                setSavedAttempts((prev) => {
                  const next = { ...prev };
                  delete next[p.id];
                  return next;
                });
              }}
              className="px-3 py-1.5 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover"
            >
              再挑戦する
            </button>
            {attempt && (
              <button
                onClick={() => void handleSaveWeaknessNote(p, attempt)}
                disabled={isSavingNote}
                className="px-3 py-1.5 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {isSavingNote ? "保存中..." : "弱点をノート保存"}
              </button>
            )}
            <details className="text-sm text-text-secondary">
              <summary className="cursor-pointer select-none">模範解答を表示</summary>
              <div className="mt-2 space-y-2">
                <div>
                  <p className="font-medium">正答</p>
                  <div className="mt-1 text-text">{renderCompactMarkdown(answerText)}</div>
                </div>
                <div>{renderMarkdown(solutionText)}</div>
              </div>
            </details>
          </div>

          {renderAttemptHistory(p, history, isLoadingHistory)}

          {renderSchemaDebugInfo(p)}
        </article>
      );
    }

    return (
      <article key={p.id} className="bg-card border border-card-border rounded-xl p-5 space-y-4">
        <header className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold text-text">問題 {idx + 1}</h2>
          <span className="text-xs px-2 py-1 rounded-full bg-background text-text-secondary">
            {p.question_type === "multiple_choice" ? "四択" : "記述式"} / {difficultyLabels[p.difficulty]}
          </span>
        </header>

        <div className="text-text">{renderMarkdown(promptText)}</div>

        {p.question_type === "multiple_choice" ? (
          <div className="space-y-2">
            {choiceItems.map((choice, optionIdx) => {
              const optionValue = choice.value;
              return (
                <label key={`${p.id}-${choice.key}-${optionIdx}`} className="flex items-start gap-2 text-sm text-text">
                  <input
                    type="radio"
                    name={`mcq-${p.id}`}
                    checked={currentAnswer === optionValue}
                    onChange={() =>
                      setAnswerMap((prev) => ({
                        ...prev,
                        [p.id]: {
                          ...getAnswerDraft(prev, p.id),
                          finalAnswer: optionValue,
                        },
                      }))
                    }
                  />
                  <div className="min-w-0 flex-1">{renderCompactMarkdown(choice.displayText)}</div>
                </label>
              );
            })}
          </div>
        ) : (
          <div className="space-y-3">
            <div className="rounded-lg border border-card-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-secondary">手書き画像から取り込む</p>
                <p className="text-xs text-text-muted">紙に書いた式を撮影して回答欄に追加できます</p>
              </div>
              <div className="mt-2 rounded-lg border border-card-border bg-card p-3">
                <details className="text-xs text-text-secondary">
                  <summary className="cursor-pointer select-none font-medium">撮影ガイドを開く</summary>
                  <div className="mt-2">
                    <ul className="list-disc space-y-1 pl-4 text-text-muted">
                      <li>1問分だけが入るように、式の周囲をなるべく余白少なく撮影</li>
                      <li>真上から撮影し、紙の傾きや台形ゆがみをできるだけ減らす</li>
                      <li>影や手の映り込みを避け、明るい場所でピントを合わせる</li>
                      <li>ペンは濃い色を使い、細かい添字や分数線をはっきり書く</li>
                    </ul>
                    <details className="mt-2 text-text-secondary">
                      <summary className="cursor-pointer select-none">うまく読み取れないとき</summary>
                      <div className="mt-2 space-y-1 text-text-muted">
                        <p>・式の行間を広めにして、行が重ならないように撮り直してください。</p>
                        <p>・問題文と解答が同時に写る場合は、解答部分だけを撮影してください。</p>
                        <p>・複数枚ある場合は、1枚ずつ取り込んで確認すると精度が安定します。</p>
                      </div>
                    </details>
                  </div>
                </details>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => answerImageInputRefs.current[p.id]?.click()}
                  disabled={isExtracting}
                  className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-2 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text disabled:opacity-50"
                >
                  <HiOutlinePhoto className="h-4 w-4" />
                  {isExtracting ? "読み取り中..." : "紙の式を画像で送る"}
                </button>
                <input
                  ref={(node) => {
                    answerImageInputRefs.current[p.id] = node;
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp,image/gif"
                  className="hidden"
                  onChange={(e) =>
                    handleAnswerImageSelected(
                      p.id,
                      e.target.files?.[0] ?? null,
                      isSaved,
                    )
                  }
                />
                <p className="text-xs text-text-muted">PNG / JPG / WEBP / GIF</p>
              </div>
              {extractionMessage && (
                <p className="mt-2 text-xs text-text-secondary">{extractionMessage}</p>
              )}
            </div>
            <div className="rounded-lg border border-card-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-secondary">数式テンプレート</p>
                <p className="text-xs text-text-muted">選択中の入力欄にそのまま挿入できます</p>
              </div>
              <div className="mt-2 flex flex-wrap gap-2">
                {mathTemplates.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => insertMathTemplate(p.id, item.template, isSaved)}
                    className="rounded-full border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-4">
              <div className="rounded-lg border border-card-border bg-background p-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-xs font-medium text-text-secondary">途中式</p>
                    <p className="text-xs text-text-muted">手書きで計算過程を記入してください</p>
                  </div>
                  <button
                    type="button"
                    aria-expanded={!isWorkingStepsCollapsed}
                    aria-label={isWorkingStepsCollapsed ? "途中式パネルを開く" : "途中式パネルを閉じる"}
                    onClick={() => {
                      setCollapsedWorkingStepIds((prev) => {
                        const next = new Set(prev);
                        if (next.has(p.id)) {
                          next.delete(p.id);
                        } else {
                          next.add(p.id);
                        }
                        return next;
                      });
                    }}
                    className="inline-flex items-center gap-2 rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs font-medium text-text-secondary hover:bg-hover hover:text-text"
                  >
                    <HiChevronDown
                      className={`h-4 w-4 transition-transform ${isWorkingStepsCollapsed ? "rotate-0" : "rotate-180"}`}
                    />
                  </button>
                </div>
                {!isWorkingStepsCollapsed && (
                  <div className="mt-3">
                    <HandwritingCanvas
                      width={800}
                      height={400}
                      onCapture={(imageBase64) => {
                        setAnswerMap((prev) => ({
                          ...prev,
                          [p.id]: {
                            ...getAnswerDraft(prev, p.id),
                            workingSteps: imageBase64,
                          },
                        }));
                        canvasStateRef.current[p.id] = true;
                      }}
                    />
                  </div>
                )}
              </div>

              <label className="block rounded-lg border border-card-border bg-background p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-xs font-medium text-text-secondary">最終解答</p>
                  <p className="text-xs text-text-muted">最後の答えだけを簡潔に書く欄</p>
                </div>
                <textarea
                  ref={(node) => {
                    finalAnswerInputRefs.current[p.id] = node;
                  }}
                  className="mt-2 w-full min-h-32 rounded-lg border border-card-border px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
                  placeholder="例: 3(x^3-2x+5)^2(3x^2-2)"
                  value={currentDraft.finalAnswer}
                  onFocus={() => {
                    activeAnswerFieldRef.current[p.id] = "finalAnswer";
                  }}
                  onChange={(e) =>
                    setAnswerMap((prev) => ({
                      ...prev,
                      [p.id]: {
                        ...getAnswerDraft(prev, p.id),
                        finalAnswer: e.target.value,
                      },
                    }))
                  }
                />
              </label>
            </div>
            <div className="rounded-lg border border-card-border bg-background p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-text-secondary">入力プレビュー</p>
                <p className="text-xs text-text-muted">プレーン入力は簡易変換して数式らしく表示します</p>
              </div>
              <div className="mt-3 grid gap-3 lg:grid-cols-2">
                <div>
                  <p className="text-xs font-medium text-text-secondary">途中式プレビュー</p>
                  <div className="mt-2 text-text">
                    {currentDraft.workingSteps.trim() ? (
                      currentDraft.workingSteps.startsWith('data:image') ? (
                        <Image
                          src={currentDraft.workingSteps}
                          alt="途中式"
                          width={960}
                          height={540}
                          unoptimized
                          className="max-w-full h-auto rounded border border-card-border"
                        />
                      ) : (
                        renderMarkdown(toPreviewMarkdown(currentDraft.workingSteps))
                      )
                    ) : (
                      <p className="text-sm text-text-muted">まだ途中式が入力されていません。</p>
                    )}
                  </div>
                </div>
                <div>
                  <p className="text-xs font-medium text-text-secondary">最終解答プレビュー</p>
                  <div className="mt-2 text-text">
                    {currentDraft.finalAnswer.trim() ? (
                      renderMarkdown(toPreviewMarkdown(currentDraft.finalAnswer))
                    ) : (
                      <p className="text-sm text-text-muted">まだ最終解答が入力されていません。</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        <div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleSubmit(p, isSaved)}
              disabled={isSubmitting}
              className="px-4 py-2 rounded-lg bg-success text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
            >
              {isSubmitting ? "採点中..." : "採点する"}
            </button>
            {attempt && (
              <button
                onClick={() => void handleSaveWeaknessNote(p, attempt)}
                disabled={isSavingNote}
                className="px-4 py-2 rounded-lg bg-accent text-white text-sm font-medium hover:opacity-90 disabled:opacity-50"
              >
                {isSavingNote ? "保存中..." : "弱点をノート保存"}
              </button>
            )}
          </div>
        </div>

        {renderAttemptHistory(p, history, isLoadingHistory)}

        {renderSchemaDebugInfo(p)}

        {attempt && (
          <div className={`border rounded-lg p-3 space-y-2 ${attemptCardClass}`}>
            <div className="space-y-1">
              <p className={`text-lg font-bold ${attemptStatusClass}`}>{attemptStatusTitle}</p>
              <p className="text-sm font-semibold text-text">
                スコア: {formatScore(attempt.score)} / {formatScore(attempt.max_score)}点 {attempt.is_correct ? "(採点結果: 正解)" : "(採点結果: 不正解)"}
              </p>
            </div>
            <div className="text-sm text-text">{renderMarkdown(attempt.feedback)}</div>
            {renderAttemptBreakdown(attempt)}
            {(attempt.mistake_points ?? []).length > 0 && (
              <ul className="list-disc pl-5 text-sm text-warning">
                {(attempt.mistake_points ?? []).map((m, i) => (
                  <li key={`${attempt.id}-${i}`}>{m}</li>
                ))}
              </ul>
            )}
            {attempt.equivalence_note && (
              <p className="text-sm text-text-secondary">判定メモ: {attempt.equivalence_note}</p>
            )}
            {attempt.next_hint && (
              <p className="text-sm text-primary">ヒント: {attempt.next_hint}</p>
            )}
            <details className="text-sm text-text-secondary">
              <summary className="cursor-pointer select-none">模範解答を表示</summary>
              <div className="mt-2 space-y-2">
                <div>
                  <p className="font-medium">正答</p>
                  <div className="mt-1 text-text">{renderCompactMarkdown(answerText)}</div>
                </div>
                <div>{renderMarkdown(solutionText)}</div>
              </div>
            </details>
          </div>
        )}
      </article>
    );
  }

  return (
    <div className="p-6 max-w-5xl mx-auto space-y-6">
      {toast && (
        <div className="fixed right-4 top-4 z-50 max-w-sm rounded-2xl border border-success bg-success px-4 py-3 text-sm font-medium text-white shadow-lg">
          {toast.message}
        </div>
      )}

      <div>
        <h1 className="text-2xl font-bold text-text">問題演習・自動採点</h1>
        <p className="text-sm text-text-muted mt-1">
          トピックを選び、問題を生成して回答すると自動で採点されます。
        </p>
      </div>

      <section className="bg-card border border-card-border rounded-xl p-4 space-y-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <label className="text-sm text-text-secondary">
            トピック
            <select
              className="mt-1 w-full rounded-lg border border-card-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              value={selectedTopicId ?? ""}
              onChange={(e) => setSelectedTopicId(Number(e.target.value))}
              disabled={isLoadingCurriculum || topics.length === 0}
            >
              {topics.length === 0 && <option value="">トピックなし</option>}
              {topics.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>

          <label className="text-sm text-text-secondary">
            難易度
            <select
              className="mt-1 w-full rounded-lg border border-card-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              value={difficulty}
              onChange={(e) => setDifficulty(e.target.value as Difficulty)}
            >
              <option value="easy">{difficultyLabels.easy}</option>
              <option value="medium">{difficultyLabels.medium}</option>
              <option value="hard">{difficultyLabels.hard}</option>
            </select>
          </label>

          <label className="text-sm text-text-secondary">
            問題数
            <input
              className="mt-1 w-full rounded-lg border border-card-border px-3 py-2 focus:outline-none focus:ring-2 focus:ring-primary"
              type="number"
              min={1}
              max={10}
              value={count}
              onChange={(e) => setCount(Math.max(1, Math.min(10, Number(e.target.value) || 1)))}
            />
          </label>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleGenerate}
            disabled={isGenerating || !selectedTopicId}
            className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover disabled:opacity-50"
          >
            {isGenerating ? "生成中..." : "問題を生成"}
          </button>
          {stats && (
            <div className="text-xs text-text-secondary">
              回答数: {stats.total_attempts} / 問題数: {stats.total_problems} / 平均点: {formatScore(stats.avg_score)}
              点 / 正答率: {(stats.accuracy_rate * 100).toFixed(1)}%
            </div>
          )}
        </div>

        {weaknessSummary.total > 0 && (
          <div className="rounded-lg border border-card-border bg-background p-3">
            <p className="text-xs font-semibold text-text-secondary">弱点サマリー（現在セッション）</p>
            <div className="mt-2 flex flex-wrap gap-2 text-xs">
              <span className="rounded-full bg-warning-light px-2 py-1 text-warning">
                概念: {weaknessSummary.concept}件
              </span>
              <span className="rounded-full bg-warning-light px-2 py-1 text-warning">
                計算: {weaknessSummary.calculation}件
              </span>
              <span className="rounded-full bg-warning-light px-2 py-1 text-warning">
                最終答: {weaknessSummary.finalAnswer}件
              </span>
            </div>
          </div>
        )}

        {errorMessage && (
          <div className="text-sm text-error bg-error-light border border-error rounded-lg px-3 py-2">
            {errorMessage}
          </div>
        )}
      </section>

      {/* タブ切り替え */}
      <div className="flex gap-1 bg-card border border-card-border rounded-xl p-1">
        <button
          onClick={() => setActiveTab("generate")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "generate"
              ? "bg-primary text-white"
              : "text-text-secondary hover:bg-hover"
          }`}
        >
          生成した問題
        </button>
        <button
          onClick={() => setActiveTab("saved")}
          className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
            activeTab === "saved"
              ? "bg-primary text-white"
              : "text-text-secondary hover:bg-hover"
          }`}
        >
          保存済み問題一覧
        </button>
      </div>

      {activeTab === "generate" && (
        <section className="space-y-4">
          {problems.length === 0 ? (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center text-text-muted">
              まだ問題が生成されていません。
            </div>
          ) : (
            problems.map((p, idx) => renderProblemCard(p, idx, false))
          )}
        </section>
      )}

      {activeTab === "saved" && (
        <section className="space-y-4">
          {isLoadingSaved ? (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center text-text-muted">
              読み込み中...
            </div>
          ) : savedProblems.length === 0 ? (
            <div className="bg-card border border-card-border rounded-xl p-8 text-center text-text-muted">
              保存済みの問題はありません。上の「問題を生成」で問題を作成してください。
            </div>
          ) : (
            groupedSavedProblems.map((group) => (
              <section key={group.topicId} className="space-y-3">
                <div className="flex items-center justify-between gap-3 rounded-xl border border-card-border bg-card px-4 py-3">
                  <div>
                    <p className="text-sm font-semibold text-text">{group.topicLabel}</p>
                    <p className="text-xs text-text-muted">保存済み {group.problems.length} 問</p>
                  </div>

                  {bulkDeleteTopicId === group.topicId ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm text-text-secondary">
                        このトピックの全{group.problems.length}問を削除しますか？
                      </span>
                      <button
                        onClick={() => handleBulkDelete(group.topicId)}
                        className="px-3 py-1.5 bg-error text-white rounded-lg text-sm hover:opacity-80"
                      >
                        全削除
                      </button>
                      <button
                        onClick={() => setBulkDeleteTopicId(null)}
                        className="px-3 py-1.5 bg-background text-text-secondary rounded-lg text-sm hover:bg-hover"
                      >
                        取消
                      </button>
                    </div>
                  ) : (
                    <button
                      onClick={() => setBulkDeleteTopicId(group.topicId)}
                      className="flex items-center gap-1 px-3 py-1.5 text-text-muted hover:text-error transition-colors text-sm"
                    >
                      <HiOutlineTrash className="w-4 h-4" />
                      このトピックを一括削除
                    </button>
                  )}
                </div>

                {group.problems.map((p, idx) => renderProblemCard(p, idx, true))}
              </section>
            ))
          )}
        </section>
      )}

      {pendingCrop && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-2xl border border-card-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-text">抽出範囲をトリミング</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  画像上をドラッグして、抽出したい式の範囲を選択してください。
                </p>
              </div>
              <button
                type="button"
                onClick={closePendingCrop}
                className="rounded-lg px-2 py-1 text-sm text-text-muted hover:bg-hover hover:text-text"
              >
                閉じる
              </button>
            </div>

            <div
              ref={cropStageRef}
              className="relative mt-4 overflow-hidden rounded-xl border border-card-border bg-background"
              onPointerDown={handleCropPointerDown}
              onPointerMove={handleCropPointerMove}
              onPointerUp={handleCropPointerUp}
              onPointerLeave={handleCropPointerUp}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                ref={cropImageRef}
                src={pendingCrop.objectUrl}
                alt="トリミング対象"
                className="block max-h-[60vh] w-full object-contain select-none"
                draggable={false}
              />

              {cropRect && (
                <>
                  <div
                    className="pointer-events-none absolute border-2 border-primary bg-primary/15"
                    style={{
                      left: cropRect.x,
                      top: cropRect.y,
                      width: cropRect.width,
                      height: cropRect.height,
                    }}
                  />
                  <div className="pointer-events-none absolute left-2 top-2 rounded bg-black/60 px-2 py-1 text-xs text-white">
                    {Math.round(cropRect.width)} x {Math.round(cropRect.height)} px
                  </div>

                  <button
                    type="button"
                    onPointerDown={(e) => handleCropResizePointerDown(e, "nw")}
                    className="absolute h-4 w-4 rounded-full border-2 border-white bg-primary shadow cursor-nwse-resize"
                    style={{ left: cropRect.x - 8, top: cropRect.y - 8 }}
                    aria-label="左上を調整"
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => handleCropResizePointerDown(e, "ne")}
                    className="absolute h-4 w-4 rounded-full border-2 border-white bg-primary shadow cursor-nesw-resize"
                    style={{ left: cropRect.x + cropRect.width - 8, top: cropRect.y - 8 }}
                    aria-label="右上を調整"
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => handleCropResizePointerDown(e, "sw")}
                    className="absolute h-4 w-4 rounded-full border-2 border-white bg-primary shadow cursor-nesw-resize"
                    style={{ left: cropRect.x - 8, top: cropRect.y + cropRect.height - 8 }}
                    aria-label="左下を調整"
                  />
                  <button
                    type="button"
                    onPointerDown={(e) => handleCropResizePointerDown(e, "se")}
                    className="absolute h-4 w-4 rounded-full border-2 border-white bg-primary shadow cursor-nwse-resize"
                    style={{ left: cropRect.x + cropRect.width - 8, top: cropRect.y + cropRect.height - 8 }}
                    aria-label="右下を調整"
                  />
                </>
              )}
            </div>

            <div className="mt-3 text-xs text-text-muted">
              {cropRect
                ? "選択範囲で抽出するか、画像全体で抽出するか選べます。"
                : "範囲を選択しない場合は、画像全体が抽出対象になります。"}
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={closePendingCrop}
                className="rounded-lg border border-card-border bg-background px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={useOriginalAndExtract}
                className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover"
              >
                画像全体で抽出
              </button>
              <button
                type="button"
                onClick={confirmCropAndExtract}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                選択範囲で抽出
              </button>
            </div>
          </div>
        </div>
      )}

      {pendingExtraction && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-2xl rounded-2xl border border-card-border bg-card p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-text">抽出結果を確認</h2>
                <p className="mt-1 text-sm text-text-secondary">
                  回答欄へ反映する前に、画像から読み取った数式を確認してください。
                </p>
              </div>
              <button
                type="button"
                onClick={cancelPendingExtraction}
                className="rounded-lg px-2 py-1 text-sm text-text-muted hover:bg-hover hover:text-text"
              >
                閉じる
              </button>
            </div>

            <div className="mt-4 grid gap-4 md:grid-cols-2">
              <div className="rounded-xl border border-card-border bg-background p-4">
                <p className="text-xs font-medium text-text-secondary">抽出テキスト</p>
                <pre className="mt-2 whitespace-pre-wrap break-words text-sm text-text-secondary">
                  {pendingExtraction.extractedText}
                </pre>
              </div>
              <div className="rounded-xl border border-card-border bg-background p-4">
                <p className="text-xs font-medium text-text-secondary">数式プレビュー</p>
                <div className="mt-2 text-text">
                  {renderMarkdown(pendingExtraction.extractedText)}
                </div>
              </div>
            </div>

            <div className="mt-5 flex flex-wrap justify-end gap-2">
              <button
                type="button"
                onClick={cancelPendingExtraction}
                className="rounded-lg border border-card-border bg-background px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover"
              >
                キャンセル
              </button>
              <button
                type="button"
                onClick={() => applyPendingExtraction("append")}
                className="rounded-lg border border-card-border bg-card px-4 py-2 text-sm font-medium text-text-secondary hover:bg-hover"
              >
                回答欄に追記
              </button>
              <button
                type="button"
                onClick={() => applyPendingExtraction("replace")}
                className="rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white hover:bg-primary-hover"
              >
                回答欄を置換
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
