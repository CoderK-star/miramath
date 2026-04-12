function resolveApiBase(): string {
  if (process.env.NEXT_PUBLIC_API_BASE) {
    return process.env.NEXT_PUBLIC_API_BASE;
  }
  if (typeof window !== "undefined") {
    return `${window.location.protocol}//${window.location.hostname}:8000`;
  }
  return "http://127.0.0.1:8000";
}

const API_BASE = resolveApiBase();

type ApiErrorResponse = {
  error?: {
    code?: string;
    message?: string;
    request_id?: string;
  };
};

function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function toErrorMessage(status: number, payloadText: string): string {
  try {
    const parsed = JSON.parse(payloadText) as ApiErrorResponse;
    const message = parsed.error?.message;
    const requestId = parsed.error?.request_id;
    if (message) {
      return requestId
        ? `API Error ${status}: ${message} (request_id=${requestId})`
        : `API Error ${status}: ${message}`;
    }
  } catch {
    // noop: fallback to plain text
  }
  return `API Error ${status}: ${payloadText}`;
}

function shouldRetryStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

export async function apiFetch<T>(
  path: string,
  options?: RequestInit,
  retries = 1
): Promise<T> {
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    let res: Response;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: "include",
        headers: {
          "Content-Type": "application/json",
          ...options?.headers,
        },
      });
    } catch (err) {
      const detail = err instanceof Error ? err.message : String(err);
      if (attempt < retries) {
        await wait(300 * (attempt + 1));
        continue;
      }
      throw new Error(
        `Network Error: backend (${API_BASE}) に接続できません。${detail}`
      );
    }

    if (res.ok) {
      return res.json();
    }

    const text = await res.text();
    if (
      res.status === 401 &&
      typeof window !== "undefined" &&
      window.location.pathname !== "/login"
    ) {
      window.location.replace("/login");
    }
    if (attempt < retries && shouldRetryStatus(res.status)) {
      await wait(300 * (attempt + 1));
      continue;
    }
    throw new Error(toErrorMessage(res.status, text));
  }

  throw new Error("API request failed after retries");
}

// --- Chat ---

export interface Conversation {
  id: number;
  title: string;
  created_at: string;
  updated_at: string;
}

export interface Message {
  id: number;
  role: "user" | "assistant";
  content: string;
  image_path: string | null;
  created_at: string;
}

export function listConversations() {
  return apiFetch<Conversation[]>("/api/chat/conversations");
}

export function getMessages(conversationId: number) {
  return apiFetch<Message[]>(
    `/api/chat/conversations/${conversationId}/messages`
  );
}

export function createConversation() {
  return apiFetch<Conversation>("/api/chat/conversations", { method: "POST" });
}

export function deleteConversation(conversationId: number) {
  return apiFetch(`/api/chat/conversations/${conversationId}`, {
    method: "DELETE",
  });
}

export async function sendMessage(
  conversationId: number,
  message: string,
  image?: File,
  onChunk?: (text: string) => void
): Promise<string> {
  const formData = new FormData();
  formData.append("message", message);
  formData.append("conversation_id", String(conversationId));
  if (image) {
    formData.append("image", image);
  }

  const res = await fetch(`${API_BASE}/api/chat/send`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    throw new Error(`API Error ${res.status}`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new Error("No response body");

  const decoder = new TextDecoder();
  let fullText = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    const text = decoder.decode(value, { stream: true });
    const lines = text.split("\n");

    for (const line of lines) {
      if (line.startsWith("data: ")) {
        try {
          const data = JSON.parse(line.slice(6));
          if (data.type === "chunk") {
            fullText += data.content;
            onChunk?.(fullText);
          } else if (data.type === "error") {
            throw new Error(data.content);
          }
        } catch (e) {
          if (e instanceof SyntaxError) continue;
          throw e;
        }
      }
    }
  }

  return fullText;
}

// --- Curriculum ---

export interface Topic {
  id: number;
  title: string;
  description: string;
  status: "not_started" | "in_progress" | "completed";
  order: number;
}

export interface Section {
  id: number;
  title: string;
  description: string;
  order: number;
  topics: Topic[];
}

export interface Unit {
  id: number;
  title: string;
  description: string;
  order: number;
  sections: Section[];
}

export function getCurriculum() {
  return apiFetch<Unit[]>("/api/curriculum");
}

export function generateCurriculum() {
  return apiFetch<Unit[]>("/api/curriculum/generate", { method: "POST" });
}

export function updateTopicStatus(topicId: number, status: string) {
  return apiFetch<Topic>(`/api/curriculum/topics/${topicId}`, {
    method: "PATCH",
    body: JSON.stringify({ status }),
  });
}

// --- Materials ---

export interface Material {
  id: number;
  original_filename: string;
  file_type: string;
  file_size: number;
  chunk_count: number;
  status: string;
  error_message: string | null;
  created_at: string;
}

export function listMaterials() {
  return apiFetch<Material[]>("/api/materials");
}

export async function uploadMaterial(file: File): Promise<Material> {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/materials/upload`, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload Error ${res.status}: ${text}`);
  }
  return res.json();
}

export function deleteMaterial(materialId: number) {
  return apiFetch(`/api/materials/${materialId}`, { method: "DELETE" });
}

// --- Progress ---

export interface ProgressSummary {
  total_topics: number;
  completed_topics: number;
  in_progress_topics: number;
  completion_rate: number;
  total_study_minutes: number;
}

export interface StudySession {
  id: number;
  topic_id: number | null;
  topic_title: string;
  duration_minutes: number;
  started_at: string;
  ended_at: string | null;
  status: string;
}

export function getProgressSummary() {
  return apiFetch<ProgressSummary>("/api/progress/summary");
}

export function listSessions() {
  return apiFetch<StudySession[]>("/api/progress/sessions");
}

export function startSession(topicId?: number, topicTitle?: string) {
  return apiFetch<StudySession>("/api/progress/sessions/start", {
    method: "POST",
    body: JSON.stringify({
      topic_id: topicId ?? null,
      topic_title: topicTitle ?? "",
    }),
  });
}

export function endSession(sessionId: number) {
  return apiFetch<StudySession>(`/api/progress/sessions/${sessionId}/end`, {
    method: "POST",
  });
}

// --- Notes ---

export interface Note {
  id: number;
  title: string;
  category: string;
  image_data: string;
  created_at: string;
  updated_at: string;
}

export interface NotePayload {
  title: string;
  category: string;
  image_data: string;
}

export function listNotes() {
  return apiFetch<Note[]>("/api/notes");
}

export function createNote(payload: NotePayload) {
  return apiFetch<Note>("/api/notes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateNote(noteId: number, payload: NotePayload) {
  return apiFetch<Note>(`/api/notes/${noteId}`, {
    method: "PATCH",
    body: JSON.stringify(payload),
  });
}

export function deleteNote(noteId: number) {
  return apiFetch<{ ok: boolean }>(`/api/notes/${noteId}`, {
    method: "DELETE",
  });
}

// --- Settings ---

export interface LLMSettings {
  system_prompt: string;
}

export function getLLMSettings() {
  return apiFetch<LLMSettings>("/api/settings/llm");
}

export function updateLLMSettings(payload: LLMSettings) {
  return apiFetch<LLMSettings>("/api/settings/llm", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

// --- Practice ---

export type PracticeQuestionType = "free_text" | "multiple_choice";
export type PracticeDifficulty = "easy" | "medium" | "hard";
export type PracticeMathFormat = "markdown_latex" | "plain_text";
export type PracticePreferredInputMode = "text" | "math" | "choice" | "image";
export type PracticeEquivalenceMode = "exact" | "symbolic" | "ai" | "symbolic_or_ai";

export interface PracticePromptSpec {
  text: string;
  math_format: PracticeMathFormat;
}

export interface PracticeChoiceSpec {
  id: string;
  label: string;
  display_text: string;
  value_text: string;
}

export interface PracticeAnswerSpec {
  display_text: string;
  canonical_text: string;
  accepted_variants: string[];
  correct_choice_id: string | null;
}

export interface PracticeSolutionSpec {
  text: string;
  math_format: PracticeMathFormat;
}

export interface PracticeInputHintsSpec {
  preferred_mode: PracticePreferredInputMode;
  template_keys: string[];
  allow_handwritten_image: boolean;
}

export interface PracticeGradingSpec {
  equivalence_mode: PracticeEquivalenceMode;
  accept_choice_labels: boolean;
  accept_choice_indices: boolean;
  keywords: string[];
}

export interface PracticeProblem {
  id: number;
  topic_id: number;
  question_type: PracticeQuestionType;
  difficulty: PracticeDifficulty;
  question_text: string;
  options: string[] | null;
  correct_answer: string;
  solution_text: string;
  prompt: PracticePromptSpec;
  choices: PracticeChoiceSpec[] | null;
  answer: PracticeAnswerSpec;
  solution: PracticeSolutionSpec;
  input_hints: PracticeInputHintsSpec;
  grading: PracticeGradingSpec;
  created_at: string;
  attempt_count: number;
  best_score: number;
  max_score: number;
}

export interface PracticeAttempt {
  id: number;
  problem_id: number;
  user_answer: string;
  working_steps: string;
  final_answer: string;
  score: number;
  max_score: number;
  is_correct: boolean;
  feedback: string;
  mistake_points: string[] | null;
  next_hint: string;
  rubric_scores: {
    concept: number;
    calculation: number;
    final_answer: number;
  };
  mistake_summary: {
    concept: {
      title: string;
      score: number;
      has_issue: boolean;
      detail: string;
    };
    calculation: {
      title: string;
      score: number;
      has_issue: boolean;
      detail: string;
    };
    final_answer: {
      title: string;
      score: number;
      has_issue: boolean;
      detail: string;
    };
  };
  equivalence_note: string;
  submitted_at: string;
}

export interface PracticeStats {
  total_attempts: number;
  total_problems: number;
  avg_score: number;
  accuracy_rate: number;
}

export interface PracticeWeakTopic {
  topic_id: number;
  topic_title: string;
  attempt_count: number;
  avg_score: number;
  concept_issues: number;
  calculation_issues: number;
  final_answer_issues: number;
  priority_score: number;
}

export interface ExtractPracticeAnswerImageResult {
  extracted_text: string;
}

export function generatePracticeProblems(
  topicId: number,
  difficulty: "easy" | "medium" | "hard",
  count: number
) {
  return apiFetch<{ problems: PracticeProblem[] }>("/api/practice/problems/generate", {
    method: "POST",
    body: JSON.stringify({ topic_id: topicId, difficulty, count }),
  });
}

export function listPracticeProblems(opts?: {
  topicId?: number;
  difficulty?: string;
  questionType?: string;
}) {
  const params = new URLSearchParams();
  if (opts?.topicId) params.set("topic_id", String(opts.topicId));
  if (opts?.difficulty) params.set("difficulty", opts.difficulty);
  if (opts?.questionType) params.set("question_type", opts.questionType);
  const qs = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<PracticeProblem[]>(`/api/practice/problems${qs}`);
}

export function deletePracticeProblem(problemId: number) {
  return apiFetch<{ detail: string }>(`/api/practice/problems/${problemId}`, {
    method: "DELETE",
  });
}

export function deletePracticeProblems(topicId: number) {
  return apiFetch<{ deleted_count: number }>(
    `/api/practice/problems?topic_id=${topicId}`,
    { method: "DELETE" }
  );
}

export function submitPracticeAttempt(
  problemId: number,
  submission: {
    userAnswer?: string;
    workingSteps?: string;
    finalAnswer?: string;
  }
) {
  return apiFetch<PracticeAttempt>("/api/practice/attempts", {
    method: "POST",
    body: JSON.stringify({
      problem_id: problemId,
      user_answer: submission.userAnswer ?? "",
      working_steps: submission.workingSteps ?? "",
      final_answer: submission.finalAnswer ?? "",
    }),
  });
}

export function listPracticeAttempts(problemId: number, limit = 50) {
  const params = new URLSearchParams({
    problem_id: String(problemId),
    limit: String(limit),
  });
  return apiFetch<PracticeAttempt[]>(`/api/practice/attempts?${params.toString()}`);
}

export async function extractPracticeAnswerImage(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const res = await fetch(`${API_BASE}/api/practice/answers/extract-image`, {
    method: "POST",
    body: formData,
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Upload Error ${res.status}: ${text}`);
  }

  return (await res.json()) as ExtractPracticeAnswerImageResult;
}

export function getPracticeStats(topicId?: number) {
  const qs = topicId ? `?topic_id=${topicId}` : "";
  return apiFetch<PracticeStats>(`/api/practice/stats${qs}`);
}

export function getPracticeWeakTopics(limit = 5) {
  return apiFetch<PracticeWeakTopic[]>(`/api/practice/weak-topics?limit=${limit}`);
}
