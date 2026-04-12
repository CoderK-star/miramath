"use client";

import Link from "next/link";
import { useState, useEffect, useCallback } from "react";
import {
  getPracticeWeakTopics,
  getCurriculum,
  generateCurriculum,
  updateTopicStatus,
  type PracticeWeakTopic,
  type Unit,
} from "@/lib/api";
import {
  HiOutlineSparkles,
  HiOutlineChevronDown,
  HiOutlineChevronRight,
  HiOutlineCheckCircle,
  HiOutlineClock,
} from "react-icons/hi2";
import {
  readSessionState,
  useScrollRestoration,
  writeSessionState,
} from "@/lib/pagePersistence";
import { EmptyState } from "@/components/EmptyState";

const CURRICULUM_PAGE_STATE_KEY = "curriculum.page.state.v1";

type PersistedCurriculumPageState = {
  units: Unit[];
  expandedUnits: number[];
  expandedSections: number[];
  isLoaded: boolean;
};

const statusColors = {
  not_started: "bg-background text-text-muted",
  in_progress: "bg-warning-light text-yellow-700",
  completed: "bg-success-light text-green-700",
};

const statusLabels = {
  not_started: "未着手",
  in_progress: "学習中",
  completed: "完了",
};

export default function CurriculumPage() {
  const [persistedState] = useState<PersistedCurriculumPageState | null>(() =>
    readSessionState<PersistedCurriculumPageState>(CURRICULUM_PAGE_STATE_KEY)
  );
  const [units, setUnits] = useState<Unit[]>(persistedState?.units ?? []);
  const [expandedUnits, setExpandedUnits] = useState<Set<number>>(
    new Set(persistedState?.expandedUnits ?? [])
  );
  const [expandedSections, setExpandedSections] = useState<Set<number>>(
    new Set(persistedState?.expandedSections ?? [])
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [isLoaded, setIsLoaded] = useState(persistedState?.isLoaded ?? false);
  const [isLoading, setIsLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [weakTopics, setWeakTopics] = useState<PracticeWeakTopic[]>([]);

  useScrollRestoration("curriculum.page");

  const loadCurriculum = useCallback(async () => {
    setIsLoading(true);
    try {
      const data = await getCurriculum();
      setUnits(data);
      setIsLoaded(true);
      setErrorMessage(null);
      // 全ユニットをデフォルトで展開
      setExpandedUnits(new Set(data.map((u) => u.id)));
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const refreshCurriculum = useCallback(async () => {
    try {
      const data = await getCurriculum();
      setUnits(data);
      setErrorMessage(null);
      // 既存の展開状態を保持し、削除されたユニットのIDのみ除去
      setExpandedUnits((prev) => {
        const validIds = new Set(data.map((u) => u.id));
        const next = new Set<number>();
        for (const id of prev) {
          if (validIds.has(id)) next.add(id);
        }
        return next;
      });
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    if (persistedState) {
      return;
    }
    loadCurriculum();
  }, [loadCurriculum, persistedState]);

  useEffect(() => {
    writeSessionState<PersistedCurriculumPageState>(CURRICULUM_PAGE_STATE_KEY, {
      units,
      expandedUnits: Array.from(expandedUnits),
      expandedSections: Array.from(expandedSections),
      isLoaded,
    });
  }, [units, expandedUnits, expandedSections, isLoaded]);

  useEffect(() => {
    let cancelled = false;
    async function loadWeakTopics() {
      try {
        const rows = await getPracticeWeakTopics(5);
        if (!cancelled) {
          setWeakTopics(rows);
        }
      } catch {
        if (!cancelled) {
          setWeakTopics([]);
        }
      }
    }
    loadWeakTopics();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleGenerate = async () => {
    setIsGenerating(true);
    try {
      const data = await generateCurriculum();
      setUnits(data);
      setExpandedUnits(new Set(data.map((u) => u.id)));
      setErrorMessage(null);
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setIsGenerating(false);
    }
  };

  const handleStatusChange = async (
    topicId: number,
    newStatus: string
  ) => {
    try {
      await updateTopicStatus(topicId, newStatus);
      refreshCurriculum();
    } catch (err) {
      setErrorMessage(err instanceof Error ? err.message : String(err));
    }
  };

  const toggleUnit = (id: number) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const toggleSection = (id: number) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  // 進捗率の計算
  const totalTopics = units.reduce(
    (sum, u) => sum + u.sections.reduce((s, sec) => s + sec.topics.length, 0),
    0
  );
  const completedTopics = units.reduce(
    (sum, u) =>
      sum +
      u.sections.reduce(
        (s, sec) =>
          s + sec.topics.filter((t) => t.status === "completed").length,
        0
      ),
    0
  );
  const progressRate = totalTopics > 0 ? (completedTopics / totalTopics) * 100 : 0;

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-text">学習カリキュラム</h1>
          <p className="text-sm text-text-muted mt-1">
            中学数学 → 微積分・線形代数への最短ルート
          </p>
        </div>
        <button
          onClick={handleGenerate}
          disabled={isGenerating}
          className="flex items-center gap-2 px-4 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover disabled:opacity-50 transition-colors"
        >
          <HiOutlineSparkles className="w-4 h-4" />
          {isGenerating ? "生成中..." : "AIでカリキュラムを生成"}
        </button>
      </div>

      {errorMessage && (
        <div className="mb-4 rounded-lg border border-error/30 bg-error-light p-3">
          <p className="text-sm text-error">{errorMessage}</p>
          <button
            type="button"
            onClick={loadCurriculum}
            className="mt-2 rounded-md border border-error/30 bg-white px-3 py-1.5 text-xs text-error hover:bg-error-light"
          >
            再試行
          </button>
        </div>
      )}

      {isLoading && (
        <div className="mb-4 rounded-lg border border-card-border bg-card p-3 text-sm text-text-muted">
          カリキュラムを読み込み中...
        </div>
      )}

      {weakTopics.length > 0 && (
        <section className="mb-6 rounded-xl border border-card-border bg-card p-4">
          <h2 className="text-sm font-semibold text-text">弱点上位トピック</h2>
          <p className="mt-1 text-xs text-text-muted">
            採点結果から改善優先度が高いトピックです。演習に移動して再学習できます。
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
                    平均 {topic.avg_score.toFixed(1)}点 / 回答{topic.attempt_count}回 / 弱点 {topic.concept_issues + topic.calculation_issues + topic.final_answer_issues}件
                  </p>
                </div>
                <Link
                  href={`/practice?topicId=${topic.topic_id}`}
                  className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-hover"
                >
                  このトピックを演習
                </Link>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* 進捗バー */}
      {totalTopics > 0 && (
        <div className="mb-6 bg-card rounded-xl border border-card-border p-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-text">全体進捗</span>
            <span className="text-sm text-text-secondary">
              {completedTopics} / {totalTopics} トピック完了（{progressRate.toFixed(0)}%）
            </span>
          </div>
          <div className="w-full bg-card-border rounded-full h-2.5">
            <div
              className="bg-primary h-2.5 rounded-full transition-all duration-300"
              style={{ width: `${progressRate}%` }}
            />
          </div>
        </div>
      )}

      {/* カリキュラムツリー */}
      {isLoaded && units.length === 0 && (
        <EmptyState
          icon="📚"
          title="カリキュラムがまだありません"
          description="上の「AIでカリキュラムを生成」ボタンをクリックしてください"
          className="py-20"
        />
      )}

      <div className="space-y-3">
        {units.map((unit, uIdx) => (
          <div
            key={unit.id}
            className="bg-card rounded-xl border border-card-border overflow-hidden"
          >
            {/* 大単元ヘッダー */}
            <button
              onClick={() => toggleUnit(unit.id)}
              className="w-full flex items-center gap-3 p-4 hover:bg-hover transition-colors text-left"
            >
              {expandedUnits.has(unit.id) ? (
                <HiOutlineChevronDown className="w-5 h-5 text-text-muted" />
              ) : (
                <HiOutlineChevronRight className="w-5 h-5 text-text-muted" />
              )}
              <span className="text-xs font-bold text-primary bg-primary-light px-2 py-0.5 rounded">
                Unit {uIdx + 1}
              </span>
              <span className="font-semibold text-text">{unit.title}</span>
              {unit.description && (
                <span className="text-xs text-text-muted ml-auto">{unit.description}</span>
              )}
            </button>

            {/* 小単元リスト */}
            {expandedUnits.has(unit.id) && (
              <div className="border-t border-card-border">
                {unit.sections.map((section) => (
                  <div key={section.id}>
                    <button
                      onClick={() => toggleSection(section.id)}
                      className="w-full flex items-center gap-3 px-6 py-3 hover:bg-hover transition-colors text-left border-b border-background"
                    >
                      {expandedSections.has(section.id) ? (
                        <HiOutlineChevronDown className="w-4 h-4 text-text-muted" />
                      ) : (
                        <HiOutlineChevronRight className="w-4 h-4 text-text-muted" />
                      )}
                      <span className="text-sm font-medium text-text-secondary">
                        {section.title}
                      </span>
                    </button>

                    {/* トピックリスト */}
                    {expandedSections.has(section.id) && (
                      <div className="px-8 pb-2">
                        {section.topics.map((topic) => (
                          <div
                            key={topic.id}
                            className="flex items-center gap-3 py-2 px-3 rounded-lg hover:bg-hover"
                          >
                            <button
                              onClick={() => {
                                const nextStatus =
                                  topic.status === "not_started"
                                    ? "in_progress"
                                    : topic.status === "in_progress"
                                      ? "completed"
                                      : "not_started";
                                handleStatusChange(topic.id, nextStatus);
                              }}
                              className="flex-shrink-0"
                            >
                              {topic.status === "completed" ? (
                                <HiOutlineCheckCircle className="w-5 h-5 text-success" />
                              ) : topic.status === "in_progress" ? (
                                <HiOutlineClock className="w-5 h-5 text-warning" />
                              ) : (
                                <div className="w-5 h-5 rounded-full border-2 border-card-border" />
                              )}
                            </button>
                            <div className="flex-1 min-w-0">
                              <p className="text-sm text-text">{topic.title}</p>
                              {topic.description && (
                                <p className="text-xs text-text-muted truncate">
                                  {topic.description}
                                </p>
                              )}
                            </div>
                            <span
                              className={`text-xs px-2 py-0.5 rounded-full ${statusColors[topic.status]}`}
                            >
                              {statusLabels[topic.status]}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
