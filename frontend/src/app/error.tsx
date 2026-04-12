"use client";

import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error("Global UI error:", error);
  }, [error]);

  return (
    <div className="flex h-full min-h-[60vh] items-center justify-center p-6">
      <div className="w-full max-w-xl rounded-xl border border-error/30 bg-error-light p-6 text-center">
        <h2 className="text-xl font-semibold text-text">画面の描画中にエラーが発生しました</h2>
        <p className="mt-2 text-sm text-text-secondary">
          一時的な不具合の可能性があります。再試行してください。
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-lg bg-primary px-4 py-2 text-sm text-white hover:bg-primary-hover"
        >
          再試行
        </button>
      </div>
    </div>
  );
}
