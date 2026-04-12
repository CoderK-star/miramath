"use client";

// このファイルは"サイドバーコンポーネント"を定義しています。ナビゲーションリンクとアイコンを表示し、現在のページに基づいてアクティブなリンクをハイライトします。Next.js の Link コンポーネントを使用してクライアントサイドのルーティングを実現しています。また、usePathname フックを使用して現在のパスを取得し、どのリンクがアクティブかを判断しています。
import { useEffect, useLayoutEffect, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import {
  HiOutlineChatBubbleLeftRight,
  HiOutlineAcademicCap,
  HiOutlineDocumentText,
  HiOutlineChartBar,
  HiOutlinePencilSquare,
  HiOutlineCog6Tooth,
  HiChevronLeft,
  HiChevronRight,
  HiArrowRightOnRectangle,
} from "react-icons/hi2";
import { getLLMSettings, updateLLMSettings } from "@/lib/api";

// サイドバーにあるアイテムの定義。各アイテムは、リンク先のURL、表示するラベル、アイコンコンポーネントを持っています。
const navItems = [
  { href: "/", label: "チャット", icon: HiOutlineChatBubbleLeftRight },
  { href: "/curriculum", label: "カリキュラム", icon: HiOutlineAcademicCap },
  { href: "/practice", label: "問題演習", icon: HiOutlinePencilSquare },
  { href: "/notes", label: "メモ", icon: HiOutlineDocumentText },
  { href: "/materials", label: "学習資料", icon: HiOutlineDocumentText },
  { href: "/progress", label: "進捗", icon: HiOutlineChartBar },
];

const SETTINGS_PANEL_STORAGE_KEY = "app.settingsPanelOpen";
const SYSTEM_PROMPT_PLACEHOLDER = `入力例:
あなたは数学の家庭教師です。以下のルールに従って、丁寧に教えてください。
- 中学レベルの前提知識から丁寧に説明してください
- 数式は LaTeX 形式で出力してください
- 回答はステップごとに簡潔に提示してください
- 難しい概念は身近な例えを使って説明してください
- 日本語で回答してください`;

export function Sidebar() {
  const pathname = usePathname();
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [systemPrompt, setSystemPrompt] = useState("");
  const [isLoadingSettings, setIsLoadingSettings] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [settingsInfo, setSettingsInfo] = useState<string | null>(null);

  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(SETTINGS_PANEL_STORAGE_KEY) === "true") {
        setIsSettingsOpen(true);
      }
    } catch {}
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_PANEL_STORAGE_KEY, String(isSettingsOpen));
    } catch {}
  }, [isSettingsOpen]);

  useEffect(() => {
    if (!isSettingsOpen) {
      return;
    }

    let cancelled = false;
    setIsLoadingSettings(true);
    setSettingsError(null);

    getLLMSettings()
      .then((data) => {
        if (cancelled) {
          return;
        }
        setSystemPrompt(data.system_prompt ?? "");
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        setSettingsError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) {
          setIsLoadingSettings(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [isSettingsOpen]);

  const handleSaveSettings = async () => {
    if (!systemPrompt.trim()) {
      setSettingsError("system prompt を入力してください");
      return;
    }

    setIsSavingSettings(true);
    setSettingsError(null);
    setSettingsInfo(null);
    try {
      const saved = await updateLLMSettings({
        system_prompt: systemPrompt,
      });
      setSystemPrompt(saved.system_prompt ?? "");
      setSettingsInfo("設定を保存しました。次のリクエストから反映されます。");
    } catch (err) {
      setSettingsError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSavingSettings(false);
    }
  };

  const handleLogout = async () => {
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? "";
    await fetch(`${apiBase}/api/auth/logout`, {
      method: "POST",
      credentials: "include",
    }).catch(() => {});
    window.location.replace("/login");
  };

  return (
    <div className="flex h-full">
      <aside className="w-56 bg-sidebar border-r border-sidebar-border flex flex-col">
        <div className="p-4 border-b border-sidebar-border">
          <h1 className="text-lg font-bold text-primary inline-flex items-center gap-2">
            <Image
              src="/miramath-logo.svg"
              alt="Miramath logo"
              width={20}
              height={20}
              priority
            />
            <span>Miramath</span>
          </h1>
          <p className="text-xs text-text-muted mt-1">パーソナル数学家庭教師</p>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
                  isActive
                    ? "bg-primary-light text-primary"
                    : "text-text-secondary hover:bg-hover hover:text-text"
                }`}
              >
                <item.icon className="w-5 h-5" />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-2 border-t border-sidebar-border space-y-1">
          <button
            type="button"
            onClick={() => {
              setIsSettingsOpen((prev) => !prev);
              setSettingsError(null);
              setSettingsInfo(null);
            }}
            className={`w-full flex items-center justify-between gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors ${
              isSettingsOpen
                ? "bg-primary-light text-primary"
                : "text-text-secondary hover:bg-hover hover:text-text"
            }`}
          >
            <span className="inline-flex items-center gap-3">
              <HiOutlineCog6Tooth className="w-5 h-5" />
              設定
            </span>
            {isSettingsOpen ? (
              <HiChevronLeft className="w-4 h-4" />
            ) : (
              <HiChevronRight className="w-4 h-4" />
            )}
          </button>
          <button
            type="button"
            onClick={handleLogout}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-text-secondary hover:bg-hover hover:text-text"
          >
            <HiArrowRightOnRectangle className="w-5 h-5" />
            ログアウト
          </button>
        </div>
      </aside>

      <div
        className={`bg-sidebar border-r border-sidebar-border overflow-hidden transition-all duration-300 ease-in-out ${
          isSettingsOpen
            ? "w-80 opacity-100 translate-x-0"
            : "w-0 opacity-0 -translate-x-4 pointer-events-none border-r-0"
        }`}
      >
        <div className="h-full flex flex-col">
          <div className="px-4 py-3 border-b border-sidebar-border">
            <h2 className="text-base font-semibold text-text">設定</h2>
            <p className="text-xs text-text-muted mt-1">
              system prompt をUIから設定できます。
            </p>
          </div>

          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <label className="block text-sm text-text-secondary">
              system_prompt
              <textarea
                value={systemPrompt}
                onChange={(e) => setSystemPrompt(e.target.value)}
                placeholder={SYSTEM_PROMPT_PLACEHOLDER}
                rows={12}
                className="mt-1 w-full resize-y rounded-lg border border-card-border bg-white px-3 py-2 text-sm text-text placeholder:text-text-muted focus:outline-none focus:ring-2 focus:ring-primary/30"
              />
            </label>

            {settingsError ? (
              <p className="text-sm text-error bg-error-light border border-error/30 rounded-lg px-3 py-2">
                {settingsError}
              </p>
            ) : null}

            {settingsInfo ? (
              <p className="text-sm text-success bg-success-light border border-success/30 rounded-lg px-3 py-2">
                {settingsInfo}
              </p>
            ) : null}
          </div>

          <div className="p-4 border-t border-sidebar-border flex items-center justify-end gap-2">
            {/*<button
              type="button"
              onClick={() => setIsSettingsOpen(false)}
              className="px-3 py-2 rounded-lg text-sm border border-card-border text-text-secondary hover:bg-hover"
            >
              閉じる
            </button>*/}
            <button
              type="button"
              onClick={handleSaveSettings}
              disabled={isLoadingSettings || isSavingSettings}
              className="px-3 py-2 rounded-lg text-sm bg-primary text-white hover:bg-primary-hover disabled:opacity-60"
            >
              {isLoadingSettings ? "読込中..." : isSavingSettings ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
