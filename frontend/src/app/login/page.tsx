"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!password.trim()) return;
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ password }),
      });
      if (res.ok) {
        router.replace("/");
      } else {
        setError("パスワードが正しくありません");
      }
    } catch {
      setError("ログインに失敗しました。サーバーに接続できません。");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="flex h-screen items-center justify-center bg-background">
      <form
        onSubmit={handleLogin}
        className="w-full max-w-sm space-y-5 p-8 rounded-2xl border border-card-border bg-white shadow-sm"
      >
        <div className="flex items-center gap-2">
          <Image
            src="/miramath-logo.svg"
            alt="Miramath logo"
            width={24}
            height={24}
            priority
          />
          <h1 className="text-xl font-bold text-primary">Miramath</h1>
        </div>

        <label className="block text-sm text-text-secondary">
          パスワード
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="パスワードを入力"
            autoFocus
            autoComplete="current-password"
            className="mt-1 w-full rounded-lg border border-card-border bg-white px-3 py-2 text-sm text-text focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </label>

        {error ? (
          <p className="text-sm text-error bg-error-light border border-error/30 rounded-lg px-3 py-2">
            {error}
          </p>
        ) : null}

        <button
          type="submit"
          disabled={isLoading || !password.trim()}
          className="w-full rounded-lg py-2 text-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-60 transition-colors"
        >
          {isLoading ? "確認中..." : "ログイン"}
        </button>
      </form>
    </div>
  );
}
