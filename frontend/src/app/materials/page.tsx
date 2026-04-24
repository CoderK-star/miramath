"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import {
  listMaterials,
  uploadMaterial,
  deleteMaterial,
  replaceMaterial,
  type Material,
} from "@/lib/api";
import {
  HiOutlineCloudArrowUp,
  HiOutlineTrash,
  HiOutlineDocumentText,
  HiOutlinePhoto,
  HiOutlineCheckCircle,
  HiOutlineExclamationCircle,
  HiOutlineCog6Tooth,
  HiOutlineArrowPath,
} from "react-icons/hi2";
import {
  readSessionState,
  useScrollRestoration,
  writeSessionState,
} from "@/lib/pagePersistence";
import { EmptyState } from "@/components/EmptyState";

const MATERIALS_PAGE_STATE_KEY = "materials.page.state.v1";

type PersistedMaterialsPageState = {
  materials: Material[];
};

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export default function MaterialsPage() {
  const [persistedState] = useState<PersistedMaterialsPageState | null>(() =>
    readSessionState<PersistedMaterialsPageState>(MATERIALS_PAGE_STATE_KEY)
  );
  const [materials, setMaterials] = useState<Material[]>(
    persistedState?.materials ?? []
  );
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [isUploading, setIsUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<number | null>(null);
  const [replacingId, setReplacingId] = useState<number | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const replaceFileRef = useRef<HTMLInputElement>(null);

  useScrollRestoration("materials.page");

  const loadMaterials = useCallback(async () => {
    try {
      const data = await listMaterials();
      setMaterials(data);
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (persistedState) {
      return;
    }
    loadMaterials();
  }, [loadMaterials, persistedState]);

  useEffect(() => {
    writeSessionState<PersistedMaterialsPageState>(MATERIALS_PAGE_STATE_KEY, {
      materials,
    });
  }, [materials]);

  const queueFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    const nextFiles = Array.from(files);
    setPendingFiles((prev) => {
      const seen = new Set(
        prev.map((f) => `${f.name}:${f.size}:${f.lastModified}`)
      );
      const merged = [...prev];
      for (const file of nextFiles) {
        const key = `${file.name}:${file.size}:${file.lastModified}`;
        if (!seen.has(key)) {
          merged.push(file);
          seen.add(key);
        }
      }
      return merged;
    });
    setErrorMessage(null);
  };

  const cancelPendingFiles = () => {
    setPendingFiles([]);
    if (fileRef.current) {
      fileRef.current.value = "";
    }
  };

  const removePendingFile = (target: File) => {
    setPendingFiles((prev) =>
      prev.filter(
        (file) =>
          !(
            file.name === target.name &&
            file.size === target.size &&
            file.lastModified === target.lastModified
          )
      )
    );
  };

  const handleUpload = async () => {
    if (pendingFiles.length === 0) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      for (const file of pendingFiles) {
        await uploadMaterial(file);
      }
      await loadMaterials();
      cancelPendingFiles();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
    }
  };

  const handleDelete = async (id: number) => {
    try {
      setErrorMessage(null);
      await deleteMaterial(id);
      setDeleteConfirmId(null);
      loadMaterials();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const handleReplaceClick = (id: number) => {
    setReplacingId(id);
    replaceFileRef.current?.click();
  };

  const handleReplaceFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || replacingId === null) return;
    setIsUploading(true);
    setErrorMessage(null);
    try {
      await replaceMaterial(replacingId, file);
      await loadMaterials();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsUploading(false);
      setReplacingId(null);
      if (replaceFileRef.current) replaceFileRef.current.value = "";
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    queueFiles(e.dataTransfer.files);
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "ready":
        return <HiOutlineCheckCircle className="w-5 h-5 text-success" />;
      case "processing":
        return <HiOutlineCog6Tooth className="w-5 h-5 text-warning animate-spin" />;
      case "error":
        return <HiOutlineExclamationCircle className="w-5 h-5 text-error" />;
      default:
        return null;
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text">学習資料(RAG)</h1>
        <p className="text-sm text-text-muted mt-1">
          PDF や画像をアップロードすると、チャットで参照して回答できます
        </p>
      </div>

      {errorMessage && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error-light p-3">
          <p className="text-sm text-error">{errorMessage}</p>
          <button
            type="button"
            onClick={loadMaterials}
            className="mt-2 rounded-md border border-error/30 bg-white px-3 py-1.5 text-xs text-error hover:bg-error-light"
          >
            再読み込み
          </button>
        </div>
      )}

      {/* アップロードエリア */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        className={`border-2 border-dashed rounded-xl p-10 text-center transition-colors mb-6 ${
          dragOver
            ? "border-primary bg-primary-light"
            : "border-card-border bg-card hover:border-accent"
        }`}
      >
        <HiOutlineCloudArrowUp className="w-12 h-12 mx-auto text-text-muted mb-3" />
        <p className="text-text-secondary font-medium mb-1">
          ファイルをドラッグ&ドロップ
        </p>
        <p className="text-sm text-text-muted mb-4">
          PDF, PNG, JPG, WEBP に対応
        </p>
        <button
          onClick={() => fileRef.current?.click()}
          disabled={isUploading}
          className="px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
          aria-label="資料ファイルを選択"
        >
          {isUploading ? "アップロード中..." : "ファイルを選択"}
        </button>
        <input
          ref={fileRef}
          type="file"
          multiple
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
          className="hidden"
          onChange={(e) => queueFiles(e.target.files)}
        />
        <input
          ref={replaceFileRef}
          type="file"
          accept=".pdf,.png,.jpg,.jpeg,.webp,.gif"
          className="hidden"
          onChange={handleReplaceFileChange}
        />

        {pendingFiles.length > 0 && (
          <div className="mt-4 rounded-lg border border-card-border bg-background p-3 text-left">
            <p className="text-sm font-medium text-text">
              選択中ファイル: {pendingFiles.length} 件
            </p>
            <ul className="mt-2 space-y-1">
              {pendingFiles.map((file) => {
                const key = `${file.name}:${file.size}:${file.lastModified}`;
                return (
                  <li key={key} className="flex items-center justify-between gap-3">
                    <span className="truncate text-xs text-text-secondary">
                      {file.name}
                    </span>
                    <button
                      type="button"
                      onClick={() => removePendingFile(file)}
                      disabled={isUploading}
                      className="text-xs text-error hover:text-red-700 disabled:opacity-50"
                    >
                      取り消す
                    </button>
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                onClick={handleUpload}
                disabled={isUploading || pendingFiles.length === 0}
                className="rounded-lg bg-primary px-3 py-1.5 text-xs text-white hover:bg-primary-hover disabled:opacity-50"
              >
                {isUploading ? "アップロード中..." : "アップロード開始"}
              </button>
              <button
                type="button"
                onClick={cancelPendingFiles}
                disabled={isUploading}
                className="rounded-lg border border-card-border bg-card px-3 py-1.5 text-xs text-text-secondary hover:bg-hover disabled:opacity-50"
              >
                選択をすべて取り消す
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 資料一覧 */}
      {materials.length === 0 ? (
        <EmptyState
          icon="📄"
          title="アップロードされた資料はまだありません"
          className="py-10"
        />
      ) : (
        <div className="space-y-2">
          {materials.map((mat) => (
            <div
              key={mat.id}
              className="flex items-center gap-4 bg-card border border-card-border rounded-xl p-4"
            >
              {mat.file_type === "pdf" ? (
                <HiOutlineDocumentText className="w-8 h-8 text-red-400 flex-shrink-0" />
              ) : (
                <HiOutlinePhoto className="w-8 h-8 text-blue-400 flex-shrink-0" />
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-text truncate">
                  {mat.original_filename}
                </p>
                <p className="text-xs text-text-muted">
                  {formatSize(mat.file_size)} · {mat.chunk_count} チャンク
                  {mat.error_message && (
                    <span className="text-red-500 ml-2">{mat.error_message}</span>
                  )}
                </p>
              </div>
              {statusIcon(mat.status)}
              <button
                onClick={() => handleReplaceClick(mat.id)}
                disabled={isUploading}
                className="p-2 text-text-muted hover:text-primary transition-colors disabled:opacity-50"
                aria-label={`${mat.original_filename}を取り替え`}
                title="別のファイルで取り替える"
              >
                <HiOutlineArrowPath className="w-4 h-4" />
              </button>
              {deleteConfirmId === mat.id ? (
                <div className="flex items-center gap-1">
                  <span className="text-xs text-text-muted">削除しますか？</span>
                  <button
                    onClick={() => handleDelete(mat.id)}
                    className="rounded px-2 py-1 text-xs bg-error text-white hover:bg-red-700"
                  >
                    削除
                  </button>
                  <button
                    onClick={() => setDeleteConfirmId(null)}
                    className="rounded px-2 py-1 text-xs border border-card-border text-text-secondary hover:bg-hover"
                  >
                    取り消し
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setDeleteConfirmId(mat.id)}
                  className="p-2 text-text-muted hover:text-error transition-colors"
                  aria-label={`${mat.original_filename}を削除`}
                >
                  <HiOutlineTrash className="w-4 h-4" />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
