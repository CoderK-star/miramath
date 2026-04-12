"use client";

import Link from "next/link";
import { useState, useEffect } from "react";
import {
  getPracticeWeakTopics,
  getProgressSummary,
  listSessions,
  type PracticeWeakTopic,
  type ProgressSummary,
  type StudySession,
} from "@/lib/api";
import {
  HiOutlineAcademicCap,
  HiOutlineClock,
  HiOutlineChartBar,
  HiOutlineCheckCircle,
} from "react-icons/hi2";
import {
  readSessionState,
  useScrollRestoration,
  writeSessionState,
} from "@/lib/pagePersistence";
import { EmptyState } from "@/components/EmptyState";

const PROGRESS_PAGE_STATE_KEY = "progress.page.state.v1";

type PersistedProgressPageState = {
  summary: ProgressSummary | null;
  sessions: StudySession[];
  weakTopics: PracticeWeakTopic[];
};

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes}分`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}時間${m}分` : `${h}時間`;
}

export default function ProgressPage() {
  const [persistedState] = useState<PersistedProgressPageState | null>(() =>
    readSessionState<PersistedProgressPageState>(PROGRESS_PAGE_STATE_KEY)
  );
  const [summary, setSummary] = useState<ProgressSummary | null>(
    persistedState?.summary ?? null
  );
  const [sessions, setSessions] = useState<StudySession[]>(
    persistedState?.sessions ?? []
  );
  const [weakTopics, setWeakTopics] = useState<PracticeWeakTopic[]>(
    persistedState?.weakTopics ?? []
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  useScrollRestoration("progress.page");

  const loadProgress = async () => {
    setIsLoading(true);
    setErrorMessage(null);
    try {
      const [s, sess, weak] = await Promise.all([
        getProgressSummary(),
        listSessions(),
        getPracticeWeakTopics(5),
      ]);
      setSummary(s);
      setSessions(sess);
      setWeakTopics(weak);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (persistedState) {
      return;
    }
    let cancelled = false;
    async function load() {
      setIsLoading(true);
      try {
        const [s, sess, weak] = await Promise.all([
          getProgressSummary(),
          listSessions(),
          getPracticeWeakTopics(5),
        ]);
        if (!cancelled) {
          setSummary(s);
          setSessions(sess);
          setWeakTopics(weak);
          setErrorMessage(null);
        }
      } catch (err) {
        if (!cancelled) {
          setErrorMessage(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    }
    load();
    return () => { cancelled = true; };
  }, [persistedState]);

  useEffect(() => {
    writeSessionState<PersistedProgressPageState>(PROGRESS_PAGE_STATE_KEY, {
      summary,
      sessions,
      weakTopics,
    });
  }, [summary, sessions, weakTopics]);

  if (!summary) {
    return (
      <EmptyState
        icon="📊"
        title={isLoading ? "読み込み中..." : "進捗データがありません"}
        className="h-full"
      />
    );
  }

  const cards = [
    {
      icon: HiOutlineAcademicCap,
      label: "全トピック数",
      value: summary.total_topics,
      color: "text-primary bg-primary-light",
    },
    {
      icon: HiOutlineCheckCircle,
      label: "完了済み",
      value: summary.completed_topics,
      color: "text-success bg-success-light",
    },
    {
      icon: HiOutlineChartBar,
      label: "完了率",
      value: `${(summary.completion_rate * 100).toFixed(0)}%`,
      color: "text-accent bg-primary-light",
    },
    {
      icon: HiOutlineClock,
      label: "総学習時間",
      value: formatDuration(summary.total_study_minutes),
      color: "text-warning bg-warning-light",
    },
  ];

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-text">学習進捗</h1>
        <p className="text-sm text-text-muted mt-1">
          これまでの学習状況を確認できます
        </p>
      </div>

      {errorMessage && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error-light p-3">
          <p className="text-sm text-error">{errorMessage}</p>
          <button
            type="button"
            onClick={loadProgress}
            className="mt-2 rounded-md border border-error/30 bg-white px-3 py-1.5 text-xs text-error hover:bg-error-light"
          >
            再試行
          </button>
        </div>
      )}

      {weakTopics.length > 0 && (
        <section className="mb-6 rounded-xl border border-card-border bg-card p-4">
          <h2 className="text-sm font-semibold text-text">弱点上位トピック</h2>
          <p className="mt-1 text-xs text-text-muted">
            優先的に復習すると学習効果が高いトピックです。
          </p>
          <div className="mt-3 space-y-2">
            {weakTopics.map((topic) => (
              <div
                key={topic.topic_id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-card-border bg-background px-3 py-2"
              >
                <div>
                  <p className="text-sm font-medium text-text">{topic.topic_title}</p>
                  <p className="text-xs text-text-muted">
                    平均 {topic.avg_score.toFixed(1)}点 / 回答{topic.attempt_count}回
                  </p>
                </div>
                <Link
                  href={`/practice?topicId=${topic.topic_id}`}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
                >
                  演習へ
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* サマリーカード */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
        {cards.map((card) => (
          <div
            key={card.label}
            className="bg-card border border-card-border rounded-xl p-4"
          >
            <div className={`w-10 h-10 rounded-lg flex items-center justify-center mb-3 ${card.color}`}>
              <card.icon className="w-5 h-5" />
            </div>
            <p className="text-2xl font-bold text-text">{card.value}</p>
            <p className="text-xs text-text-muted mt-1">{card.label}</p>
          </div>
        ))}
      </div>

      {/* 進捗バー */}
      <div className="bg-card border border-card-border rounded-xl p-6 mb-8">
        <h2 className="text-lg font-semibold text-text mb-4">全体進捗</h2>
        <div className="w-full bg-card-border rounded-full h-4 mb-2">
          <div
            className="bg-primary h-4 rounded-full transition-all duration-500"
            style={{ width: `${summary.completion_rate * 100}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-text-muted">
          <span>0%</span>
          <span>
            {summary.completed_topics} / {summary.total_topics} 完了
          </span>
          <span>100%</span>
        </div>
      </div>

      {/* 学習セッション履歴 */}
      <div className="bg-card border border-card-border rounded-xl p-6">
        <h2 className="text-lg font-semibold text-text mb-4">学習履歴</h2>
        {sessions.length === 0 ? (
          <EmptyState
            icon="🕘"
            title="学習セッションの記録はまだありません"
            className="py-8"
          />
        ) : (
          <div className="space-y-3">
            {sessions.map((session) => (
              <div
                key={session.id}
                className="flex items-center gap-4 p-3 rounded-lg hover:bg-hover"
              >
                <div
                  className={`w-2 h-2 rounded-full ${
                    session.status === "completed"
                      ? "bg-success"
                      : "bg-warning"
                  }`}
                />
                <div className="flex-1">
                  <p className="text-sm font-medium text-text">
                    {session.topic_title || "フリー学習"}
                  </p>
                  <p className="text-xs text-text-muted">
                    {new Date(session.started_at).toLocaleDateString("ja-JP", {
                      month: "short",
                      day: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </p>
                </div>
                <span className="text-sm text-text-secondary">
                  {formatDuration(session.duration_minutes)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
