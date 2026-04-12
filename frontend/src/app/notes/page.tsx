"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { HiOutlinePlus, HiOutlineTrash } from "react-icons/hi2";

import { HandwritingCanvas } from "@/components/HandwritingCanvas";
import {
  createNote,
  deleteNote,
  listNotes,
  updateNote,
  type Note,
  type NotePayload,
} from "@/lib/api";
import {
  readSessionState,
  useScrollRestoration,
  writeSessionState,
} from "@/lib/pagePersistence";

const NOTES_PAGE_STATE_KEY = "notes.page.state.v1";

type PersistedNotesPageState = {
  notes: Note[];
  selectedNoteId: number | null;
  title: string;
  category: string;
  imageData: string;
};

function formatDate(isoText: string) {
  const dt = new Date(isoText);
  if (Number.isNaN(dt.getTime())) {
    return "日時不明";
  }
  return dt.toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function NotesPage() {
  const [persistedState] = useState<PersistedNotesPageState | null>(() =>
    readSessionState<PersistedNotesPageState>(NOTES_PAGE_STATE_KEY)
  );
  const hasDraftOnHydrate =
    Boolean(persistedState?.title.trim()) ||
    Boolean(persistedState?.category.trim()) ||
    Boolean(persistedState?.imageData.trim());

  const [notes, setNotes] = useState<Note[]>(persistedState?.notes ?? []);
  const [selectedNoteId, setSelectedNoteId] = useState<number | null>(
    persistedState?.selectedNoteId ?? null
  );
  const selectedNoteIdRef = useRef(selectedNoteId);
  selectedNoteIdRef.current = selectedNoteId;
  const [title, setTitle] = useState(persistedState?.title ?? "");
  const [category, setCategory] = useState(persistedState?.category ?? "");
  const [imageData, setImageData] = useState(persistedState?.imageData ?? "");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  useScrollRestoration("notes.page");

  const selectedNote = useMemo(
    () => notes.find((item) => item.id === selectedNoteId) ?? null,
    [notes, selectedNoteId]
  );

  const syncEditorFromNote = useCallback((note: Note | null) => {
    if (!note) {
      setTitle("");
      setCategory("");
      setImageData("");
      return;
    }

    setTitle(note.title);
    setCategory(note.category);
    setImageData(note.image_data);
  }, []);

  const loadNotes = useCallback(async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const data = await listNotes();
      setNotes(data);
      if (data.length === 0) {
        if (!hasDraftOnHydrate) {
          setSelectedNoteId(null);
          syncEditorFromNote(null);
        }
      } else {
        const currentId = selectedNoteIdRef.current;
        const exists =
          currentId !== null && data.some((item) => item.id === currentId);
        const target = exists
          ? data.find((item) => item.id === currentId) ?? data[0]
          : data[0];

        if (!hasDraftOnHydrate || exists) {
          setSelectedNoteId(target.id);
          syncEditorFromNote(target);
        }
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [hasDraftOnHydrate, syncEditorFromNote]);

  const hasRestoredRef = useRef(Boolean(persistedState));

  useEffect(() => {
    if (hasRestoredRef.current) {
      hasRestoredRef.current = false;
      setIsLoading(false);
      return;
    }
    loadNotes();
  }, [loadNotes]);

  useEffect(() => {
    writeSessionState<PersistedNotesPageState>(NOTES_PAGE_STATE_KEY, {
      notes,
      selectedNoteId,
      title,
      category,
      imageData,
    });
  }, [notes, selectedNoteId, title, category, imageData]);

  const handleSelectNote = (note: Note) => {
    setSelectedNoteId(note.id);
    setErrorMessage(null);
    setInfoMessage(null);
    syncEditorFromNote(note);
  };

  const handleNewNote = () => {
    setSelectedNoteId(null);
    setErrorMessage(null);
    setInfoMessage("新規メモを作成中です");
    syncEditorFromNote(null);
  };

  const validatePayload = (): NotePayload | null => {
    const normalizedTitle = title.trim();
    const normalizedCategory = category.trim();
    const normalizedImage = imageData.trim();

    if (!normalizedTitle) {
      setErrorMessage("タイトルを入力してください");
      return null;
    }
    if (!normalizedCategory) {
      setErrorMessage("カテゴリを入力してください");
      return null;
    }
    if (!normalizedImage) {
      setErrorMessage("キャンバスで手書きして「確定」を押してください");
      return null;
    }

    return {
      title: normalizedTitle,
      category: normalizedCategory,
      image_data: normalizedImage,
    };
  };

  const handleSave = async () => {
    const payload = validatePayload();
    if (!payload) {
      return;
    }

    setIsSaving(true);
    setErrorMessage(null);
    setInfoMessage(null);

    try {
      const saved = selectedNote
        ? await updateNote(selectedNote.id, payload)
        : await createNote(payload);

      setInfoMessage(selectedNote ? "メモを更新しました" : "メモを作成しました");

      const refreshed = await listNotes();
      setNotes(refreshed);
      const current = refreshed.find((item) => item.id === saved.id) ?? null;
      if (current) {
        setSelectedNoteId(current.id);
        syncEditorFromNote(current);
      }
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSaving(false);
    }
  };

  const handleDelete = async (note: Note) => {
    const ok = window.confirm(`「${note.title}」を削除しますか？`);
    if (!ok) {
      return;
    }

    setErrorMessage(null);
    setInfoMessage(null);

    try {
      await deleteNote(note.id);
      const refreshed = await listNotes();
      setNotes(refreshed);

      if (refreshed.length === 0) {
        setSelectedNoteId(null);
        syncEditorFromNote(null);
      } else {
        const next = refreshed[0];
        setSelectedNoteId(next.id);
        syncEditorFromNote(next);
      }
      setInfoMessage("メモを削除しました");
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="p-6 h-full min-h-0 flex flex-col gap-4">
      <header>
        <h1 className="text-2xl font-bold text-text">手書きメモ</h1>
        <p className="text-sm text-text-muted mt-1">
          学習内容を手書きで記録し、カテゴリごとに整理できます。
        </p>
      </header>

      <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[320px_minmax(0,1fr)] gap-4">
        <section className="bg-card border border-card-border rounded-xl p-3 flex flex-col min-h-0">
          <div className="flex items-center justify-between mb-3">
            <h2 className="text-sm font-semibold text-text">メモ一覧</h2>
            <button
              type="button"
              onClick={handleNewNote}
              className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-lg text-xs bg-primary text-white hover:bg-primary-hover transition-colors"
            >
              <HiOutlinePlus className="w-4 h-4" />
              新規
            </button>
          </div>

          <div className="flex-1 min-h-0 overflow-y-auto space-y-2 pr-1">
            {isLoading ? (
              <p className="text-sm text-text-muted">読み込み中...</p>
            ) : notes.length === 0 ? (
              <div className="h-full grid place-items-center text-center text-sm text-text-muted px-4">
                <p>
                  まだメモがありません。
                  <br />
                  右側で書いて保存してください。
                </p>
              </div>
            ) : (
              notes.map((note) => {
                const active = note.id === selectedNoteId;
                return (
                  <button
                    key={note.id}
                    type="button"
                    onClick={() => handleSelectNote(note)}
                    className={`w-full text-left rounded-lg border p-3 transition-colors ${
                      active
                        ? "border-primary bg-primary-light"
                        : "border-card-border bg-white hover:bg-hover"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-text truncate">{note.title}</p>
                        <p className="text-xs text-text-secondary mt-0.5 truncate">
                          #{note.category}
                        </p>
                        <p className="text-xs text-text-muted mt-1">
                          更新: {formatDate(note.updated_at)}
                        </p>
                      </div>
                      <div
                        role="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(note);
                        }}
                        className="inline-flex items-center justify-center w-7 h-7 rounded-md text-text-muted hover:text-error hover:bg-error-light cursor-pointer"
                        aria-label={`${note.title}を削除`}
                      >
                        <HiOutlineTrash className="w-4 h-4" />
                      </div>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="bg-card border border-card-border rounded-xl p-4 flex flex-col gap-4 min-h-0 overflow-auto">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <label className="text-sm text-text-secondary">
              タイトル
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="例: 二次関数の頂点と軸"
                className="mt-1 w-full rounded-lg border border-card-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
            <label className="text-sm text-text-secondary">
              カテゴリ
              <input
                type="text"
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                placeholder="例: 代数 / 幾何 / 微積"
                className="mt-1 w-full rounded-lg border border-card-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>
          </div>

          <div className="rounded-xl border border-card-border p-3 bg-background">
            <HandwritingCanvas
              width={960}
              height={430}
              onCapture={(dataUrl) => {
                setImageData(dataUrl);
                setErrorMessage(null);
                setInfoMessage("手書き画像を更新しました。保存すると反映されます");
              }}
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-xs text-text-muted">
              {selectedNote ? `作成: ${formatDate(selectedNote.created_at)}` : "新規メモ"}
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={isSaving}
              className="px-4 py-2 rounded-lg bg-primary text-white text-sm font-medium hover:bg-primary-hover disabled:opacity-60 transition-colors"
            >
              {isSaving ? "保存中..." : selectedNote ? "上書き保存" : "メモを保存"}
            </button>
          </div>

          {imageData ? (
            <div className="border border-card-border rounded-lg p-3 bg-white">
              <p className="text-xs font-medium text-text-secondary mb-2">
                現在の保存対象プレビュー
              </p>
              <Image
                src={imageData}
                alt="手書きメモプレビュー"
                width={700}
                height={300}
                unoptimized
                className="max-h-56 w-auto rounded border border-card-border object-contain"
              />
            </div>
          ) : null}

          {errorMessage ? (
            <p className="text-sm text-error bg-error-light border border-error/30 rounded-lg px-3 py-2">
              {errorMessage}
            </p>
          ) : null}

          {infoMessage ? (
            <p className="text-sm text-success bg-success-light border border-success/30 rounded-lg px-3 py-2">
              {infoMessage}
            </p>
          ) : null}
        </section>
      </div>
    </div>
  );
}
