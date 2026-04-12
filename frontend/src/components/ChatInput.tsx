"use client";

import { useState, useRef } from "react";
import { HiOutlinePaperAirplane, HiOutlinePhoto } from "react-icons/hi2";

interface Props {
  onSend: (message: string, image?: File) => void;
  disabled?: boolean;
}

export function ChatInput({ onSend, disabled }: Props) {
  const [text, setText] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim() && !image) {
      setFormError("メッセージか画像を入力してください");
      return;
    }
    setFormError(null);
    onSend(text.trim(), image ?? undefined);
    setText("");
    setImage(null);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="border-t border-card-border bg-card p-4">
      {image && (
        <div className="mb-2 flex items-center gap-2 text-sm text-text-secondary">
          <HiOutlinePhoto className="w-4 h-4" />
          <span>{image.name}</span>
          <button
            type="button"
            onClick={() => setImage(null)}
            className="text-error hover:text-red-700"
            aria-label="添付画像を削除"
          >
            ✕
          </button>
        </div>
      )}
      {formError && (
        <p role="alert" className="mb-2 text-sm text-error">
          {formError}
        </p>
      )}
      <div className="flex items-end gap-2">
        <button
          type="button"
          onClick={() => fileRef.current?.click()}
          className="p-2 text-text-muted hover:text-text-secondary rounded-lg hover:bg-hover"
          title="画像を添付"
          aria-label="画像を添付"
        >
          <HiOutlinePhoto className="w-5 h-5" />
        </button>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => setImage(e.target.files?.[0] ?? null)}
        />
        <textarea
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            if (formError) {
              setFormError(null);
            }
          }}
          onKeyDown={handleKeyDown}
          placeholder="数学の質問を入力してください..."
          rows={1}
          className="flex-1 resize-none rounded-xl border border-card-border px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          disabled={disabled}
          aria-label="質問入力"
          aria-invalid={Boolean(formError)}
        />
        <button
          type="submit"
          disabled={disabled || (!text.trim() && !image)}
          className="p-2.5 bg-primary text-white rounded-xl hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          aria-label="送信"
        >
          <HiOutlinePaperAirplane className="w-5 h-5" />
        </button>
      </div>
    </form>
  );
}
