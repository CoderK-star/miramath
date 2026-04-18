"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Image from "next/image";
import { HiOutlineBars3 } from "react-icons/hi2";
import { Sidebar } from "@/components/Sidebar";

// Use relative path so requests go through Next.js rewrites proxy
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [isSidebarOpen, setIsSidebarOpen] = useState(false);

  useEffect(() => {
    fetch(`${API_BASE}/api/auth/me`, { credentials: "include" })
      .then((res) => {
        if (res.ok) {
          setIsAuthenticated(true);
        } else {
          router.replace("/login");
        }
      })
      .catch(() => {
        router.replace("/login");
      })
      .finally(() => {
        setAuthChecked(true);
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ページ遷移時にモバイルサイドバーを閉じる
  useEffect(() => {
    setIsSidebarOpen(false);
  }, [pathname]);

  // ログインページは認証チェックなしで即時表示
  if (pathname === "/login") {
    return <>{children}</>;
  }

  if (!authChecked || !isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-[100dvh] overflow-hidden">
      <Sidebar isOpen={isSidebarOpen} onClose={() => setIsSidebarOpen(false)} />
      <div className="flex flex-col flex-1 min-w-0 min-h-0">
        {/* モバイルヘッダー（md 未満のみ表示） */}
        <header className="md:hidden flex items-center gap-3 px-4 h-14 bg-sidebar border-b border-sidebar-border shrink-0">
          <button
            type="button"
            onClick={() => setIsSidebarOpen(true)}
            className="p-2 rounded-lg text-text-secondary hover:bg-hover"
            aria-label="メニューを開く"
          >
            <HiOutlineBars3 className="w-6 h-6" />
          </button>
          <Image
            src="/miramath-logo.svg"
            alt="Miramath logo"
            width={20}
            height={20}
            priority
          />
          <span className="font-bold text-primary">Miramath</span>
        </header>
        <main
          data-app-scroll-root
          className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden"
        >
          {children}
        </main>
      </div>
    </div>
  );
}
