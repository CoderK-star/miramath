"use client";

import { useEffect } from "react";

export function readSessionState<T>(storageKey: string): T | null {
  if (typeof window === "undefined") {
    return null;
  }

  try {
    const raw = window.sessionStorage.getItem(storageKey);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function writeSessionState<T>(storageKey: string, value: T) {
  if (typeof window === "undefined") {
    return;
  }

  try {
    window.sessionStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    // Ignore storage errors (private mode, quota, etc.)
  }
}

function resolveScrollElement(selector: string): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }
  return document.querySelector(selector) as HTMLElement | null;
}

export function useScrollRestoration(
  storageKey: string,
  selector = "[data-app-scroll-root]",
  enabled = true
) {
  useEffect(() => {
    if (!enabled) {
      return;
    }

    const scrollKey = `${storageKey}:scrollTop`;
    const target = resolveScrollElement(selector);
    if (!target || typeof window === "undefined") {
      return;
    }

    const saved = Number(window.sessionStorage.getItem(scrollKey) ?? "0");
    let rafId = 0;
    let timeoutId = 0;
    let cancelled = false;
    let allowAutoRestore = true;
    let lastUserScrollIntentAt = 0;
    let lastRecordedScrollTop = target.scrollTop;

    const stopAutoRestore = () => {
      allowAutoRestore = false;
      window.cancelAnimationFrame(rafId);
      window.clearTimeout(timeoutId);
    };

    const markUserScrollIntent = () => {
      lastUserScrollIntentAt = Date.now();
      stopAutoRestore();
    };

    const restoreWithRetry = (attemptsLeft: number) => {
      if (cancelled || !allowAutoRestore || !Number.isFinite(saved) || saved <= 0) {
        return;
      }

      const maxScrollTop = Math.max(0, target.scrollHeight - target.clientHeight);
      const desired = Math.min(saved, maxScrollTop);

      target.scrollTop = desired;

      const restored = Math.abs(target.scrollTop - saved) <= 2;
      if (restored || attemptsLeft <= 0) {
        allowAutoRestore = false;
        return;
      }

      timeoutId = window.setTimeout(() => {
        rafId = window.requestAnimationFrame(() => restoreWithRetry(attemptsLeft - 1));
      }, 120);
    };

    rafId = window.requestAnimationFrame(() => restoreWithRetry(80));

    const onScroll = () => {
      const now = Date.now();
      const currentTop = target.scrollTop;
      const isLikelyRouteReset =
        currentTop <= 0 &&
        lastRecordedScrollTop > 120 &&
        now - lastUserScrollIntentAt > 250;

      if (isLikelyRouteReset) {
        return;
      }

      lastRecordedScrollTop = currentTop;
      window.sessionStorage.setItem(scrollKey, String(currentTop));
    };
    target.addEventListener("scroll", onScroll, { passive: true });
    target.addEventListener("wheel", markUserScrollIntent, { passive: true });
    target.addEventListener("touchmove", markUserScrollIntent, { passive: true });
    target.addEventListener("pointerdown", markUserScrollIntent, { passive: true });

    const onKeyDown = (event: KeyboardEvent) => {
      const keys = [
        "ArrowUp",
        "ArrowDown",
        "PageUp",
        "PageDown",
        "Home",
        "End",
        " ",
      ];
      if (keys.includes(event.key)) {
        markUserScrollIntent();
      }
    };
    window.addEventListener("keydown", onKeyDown, { passive: true });

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        restoreWithRetry(4);
      }
    };
    document.addEventListener("visibilitychange", onVisibilityChange);

    return () => {
      cancelled = true;
      stopAutoRestore();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("keydown", onKeyDown);
      target.removeEventListener("wheel", markUserScrollIntent);
      target.removeEventListener("touchmove", markUserScrollIntent);
      target.removeEventListener("pointerdown", markUserScrollIntent);
      target.removeEventListener("scroll", onScroll);
    };
  }, [storageKey, selector, enabled]);
}
