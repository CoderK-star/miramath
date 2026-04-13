"use client";

import { useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Sidebar } from "@/components/Sidebar";

// Use relative path so requests go through Next.js rewrites proxy
const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "";

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [authChecked, setAuthChecked] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

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

  // ログインページは認証チェックなしで即時表示
  if (pathname === "/login") {
    return <>{children}</>;
  }

  if (!authChecked || !isAuthenticated) {
    return null;
  }

  return (
    <div className="flex h-screen overflow-hidden">
      <Sidebar />
      <main
        data-app-scroll-root
        className="flex-1 min-w-0 min-h-0 overflow-y-auto overflow-x-hidden"
      >
        {children}
      </main>
    </div>
  );
}
