"use client";

// このファイルは ChatPage コンポーネントを定義しています。会話の一覧表示、選択、メッセージの送受信など、チャット機能の主要なロジックが含まれています。
// 会話の状態は sessionStorage に保存され、ページをリロードしても復元されるようになっています。
// また、会話ごとにスクロール位置も保存され、ユーザが会話を切り替えた際に前回の位置に戻るようになっています。
import { useState, useEffect, useLayoutEffect, useRef, useCallback } from "react";
import { ChatMessage } from "@/components/ChatMessage";
import { ChatInput } from "@/components/ChatInput";
import { EmptyState } from "@/components/EmptyState";
import {
  listConversations,
  getMessages,
  createConversation,
  deleteConversation,
  sendMessage,
  type Conversation,
  type Message,
} from "@/lib/api";
import {
  readSessionState,
  writeSessionState,
} from "@/lib/pagePersistence";
import {
  HiChevronLeft,
  HiChevronRight,
  HiOutlinePlus,
  HiOutlineTrash,
} from "react-icons/hi2";

const CONVERSATION_PANEL_STORAGE_KEY = "chat.conversationPanelOpen";
const CHAT_PAGE_STATE_KEY = "chat.page.state.v1";
const CHAT_SCROLL_STORAGE_PREFIX = "chat.page.scroll.v2";
const NEAR_BOTTOM_THRESHOLD_PX = 64;

function getChatScrollStorageKey(conversationId: number) {
  return `${CHAT_SCROLL_STORAGE_PREFIX}:${conversationId}`;
}

function readChatScrollTop(conversationId: number) {
  if (typeof window === "undefined") {
    return 0;
  }

  const raw = window.sessionStorage.getItem(getChatScrollStorageKey(conversationId));
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 0) {
    return 0;
  }
  return value;
}

function writeChatScrollTop(conversationId: number, scrollTop: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.setItem(
    getChatScrollStorageKey(conversationId),
    String(Math.max(0, scrollTop))
  );
}

function removeChatScrollTop(conversationId: number) {
  if (typeof window === "undefined") {
    return;
  }

  window.sessionStorage.removeItem(getChatScrollStorageKey(conversationId));
}

function isNearBottom(element: HTMLElement, threshold = NEAR_BOTTOM_THRESHOLD_PX) {
  const distance = element.scrollHeight - (element.scrollTop + element.clientHeight);
  return distance <= threshold;
}

type PersistedChatPageState = {
  conversations: Conversation[];
  activeConvId: number | null;
  messages: Message[];
};

export default function ChatPage() {
  const [persistedState] = useState<PersistedChatPageState | null>(() =>
    readSessionState<PersistedChatPageState>(CHAT_PAGE_STATE_KEY)
  );
  const [conversations, setConversations] = useState<Conversation[]>(
    persistedState?.conversations ?? []
  );
  const [activeConvId, setActiveConvId] = useState<number | null>(
    persistedState?.activeConvId ?? null
  );
  const [isConversationPanelOpen, setIsConversationPanelOpen] = useState(false);
  // 描画前（useLayoutEffect）にlocalStorageを読むためフラッシュなし、かつ hydration mismatch も起きない
  useLayoutEffect(() => {
    try {
      if (localStorage.getItem(CONVERSATION_PANEL_STORAGE_KEY) === "true") {
        setIsConversationPanelOpen(true);
      }
    } catch {}
  }, []);
  const [messages, setMessages] = useState<Message[]>(
    persistedState?.messages ?? []
  );
  const [streamingContent, setStreamingContent] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const messagesViewportRef = useRef<HTMLDivElement | null>(null);
  const prevActiveConvIdRef = useRef<number | null>(persistedState?.activeConvId ?? null);
  const followBottomRef = useRef(true);
  const pendingRestoreTopRef = useRef(0);
  const shouldRestoreScrollRef = useRef(Boolean(persistedState?.activeConvId));
  const restoreAttemptsRef = useRef(0);
  const isProgrammaticScrollRef = useRef(false);
  const streamRafIdRef = useRef<number | null>(null);
  const lastMessageCountRef = useRef(messages.length);
  const isRestoredMountRef = useRef(Boolean(persistedState));

  const persistCurrentScrollTop = useCallback(
    (conversationId = activeConvId) => {
      if (!conversationId) {
        return;
      }

      const viewport = messagesViewportRef.current;
      if (!viewport) {
        return;
      }

      writeChatScrollTop(conversationId, viewport.scrollTop);
    },
    [activeConvId]
  );

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "auto") => {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }

    isProgrammaticScrollRef.current = true;
    viewport.scrollTo({ top: viewport.scrollHeight, behavior });
    window.setTimeout(() => {
      isProgrammaticScrollRef.current = false;
    }, 0);
  }, []);

  const handleMessagesScroll = useCallback(() => {
    const viewport = messagesViewportRef.current;
    if (!viewport) {
      return;
    }

    if (activeConvId) {
      writeChatScrollTop(activeConvId, viewport.scrollTop);
    }

    if (isProgrammaticScrollRef.current) {
      return;
    }

    followBottomRef.current = isNearBottom(viewport);
  }, [activeConvId]);

  const loadConversations = useCallback(async () => {
    try {
      const convs = await listConversations();
      setConversations(convs);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  useEffect(() => {
    if (!activeConvId) return;
    if (isRestoredMountRef.current) {
      isRestoredMountRef.current = false;
      return;
    }
    getMessages(activeConvId)
      .then((data) => {
        setMessages(data);
        setLoadError(null);
      })
      .catch((err) => {
        setLoadError(err instanceof Error ? err.message : String(err));
      });
  }, [activeConvId]);

  useEffect(() => {
    const previousConversationId = prevActiveConvIdRef.current;
    if (previousConversationId && previousConversationId !== activeConvId) {
      persistCurrentScrollTop(previousConversationId);
    }

    prevActiveConvIdRef.current = activeConvId;
    followBottomRef.current = true;

    if (!activeConvId) {
      shouldRestoreScrollRef.current = false;
      pendingRestoreTopRef.current = 0;
      restoreAttemptsRef.current = 0;
      return;
    }

    pendingRestoreTopRef.current = readChatScrollTop(activeConvId);
    shouldRestoreScrollRef.current = true;
    restoreAttemptsRef.current = 24;
  }, [activeConvId, persistCurrentScrollTop]);

  useEffect(() => {
    if (!activeConvId || !shouldRestoreScrollRef.current) {
      return;
    }

    let cancelled = false;

    const restore = () => {
      if (cancelled || !shouldRestoreScrollRef.current) {
        return;
      }

      const viewport = messagesViewportRef.current;
      if (!viewport) {
        return;
      }

      const savedTop = pendingRestoreTopRef.current;
      const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);
      const desiredTop = Math.min(savedTop, maxScrollTop);

      isProgrammaticScrollRef.current = true;
      viewport.scrollTop = desiredTop;
      window.setTimeout(() => {
        isProgrammaticScrollRef.current = false;
      }, 0);

      const canSettle = Math.abs(viewport.scrollTop - desiredTop) <= 2;
      const waitingMoreContent = savedTop > maxScrollTop + 2;

      if ((canSettle && !waitingMoreContent) || restoreAttemptsRef.current <= 0) {
        shouldRestoreScrollRef.current = false;
        followBottomRef.current = isNearBottom(viewport);
        return;
      }

      restoreAttemptsRef.current -= 1;
      window.requestAnimationFrame(restore);
    };

    window.requestAnimationFrame(restore);

    return () => {
      cancelled = true;
    };
  }, [activeConvId, messages.length]);

  useEffect(() => {
    const previousCount = lastMessageCountRef.current;
    lastMessageCountRef.current = messages.length;

    if (messages.length === 0 || messages.length === previousCount) {
      return;
    }

    const latest = messages[messages.length - 1];
    if (!latest) {
      return;
    }

    if (latest.role === "user") {
      scrollToBottom("smooth");
      return;
    }

    if (followBottomRef.current) {
      scrollToBottom("auto");
    }
  }, [messages, scrollToBottom]);

  useEffect(() => {
    if (!streamingContent || !followBottomRef.current) {
      return;
    }

    if (streamRafIdRef.current !== null) {
      window.cancelAnimationFrame(streamRafIdRef.current);
    }

    streamRafIdRef.current = window.requestAnimationFrame(() => {
      scrollToBottom("auto");
      streamRafIdRef.current = null;
    });

    return () => {
      if (streamRafIdRef.current !== null) {
        window.cancelAnimationFrame(streamRafIdRef.current);
        streamRafIdRef.current = null;
      }
    };
  }, [streamingContent, scrollToBottom]);

  useEffect(() => {
    localStorage.setItem(
      CONVERSATION_PANEL_STORAGE_KEY,
      String(isConversationPanelOpen),
    );
  }, [isConversationPanelOpen]);

  useEffect(() => {
    writeSessionState<PersistedChatPageState>(CHAT_PAGE_STATE_KEY, {
      conversations,
      activeConvId,
      messages,
    });
  }, [conversations, activeConvId, messages]);

  useEffect(() => {
    return () => {
      if (streamRafIdRef.current !== null) {
        window.cancelAnimationFrame(streamRafIdRef.current);
      }
      persistCurrentScrollTop();
    };
  }, [persistCurrentScrollTop]);

  const handleSelectConversation = (conversationId: number) => {
    if (conversationId === activeConvId) {
      return;
    }

    persistCurrentScrollTop();
    setStreamingContent("");
    setActiveConvId(conversationId);
  };

  const handleNewConversation = async () => {
    persistCurrentScrollTop();
    const conv = await createConversation();
    setConversations((prev) => [conv, ...prev]);
    setActiveConvId(conv.id);
    setMessages([]);
  };

  const handleDeleteConversation = async (id: number) => {
    await deleteConversation(id);
    removeChatScrollTop(id);
    setConversations((prev) => prev.filter((c) => c.id !== id));
    if (activeConvId === id) {
      setActiveConvId(null);
      setMessages([]);
    }
  };

  const handleSend = async (message: string, image?: File) => {
    let convId = activeConvId;
    if (!convId) {
      const conv = await createConversation();
      setConversations((prev) => [conv, ...prev]);
      convId = conv.id;
      setActiveConvId(convId);
    }

    const userMsg: Message = {
      id: Date.now(),
      role: "user",
      content: message,
      image_path: null,
      created_at: new Date().toISOString(),
    };
    followBottomRef.current = true;
    setMessages((prev) => [...prev, userMsg]);
    setIsLoading(true);
    setStreamingContent("");

    try {
      const fullText = await sendMessage(convId, message, image, (text) => {
        setStreamingContent(text);
      });

      const assistantMsg: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: fullText,
        image_path: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, assistantMsg]);
      setStreamingContent("");
      loadConversations();
    } catch (err) {
      console.error("Send error:", err);
      const errorMsg: Message = {
        id: Date.now() + 1,
        role: "assistant",
        content: `エラーが発生しました: ${err instanceof Error ? err.message : "不明なエラー"}`,
        image_path: null,
        created_at: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, errorMsg]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="relative flex h-full overflow-hidden">

      {/* 会話一覧パネル モバイル用バックドロップ */}
      <div
        className={`fixed inset-0 z-30 bg-black/50 md:hidden transition-opacity duration-300 ${
          isConversationPanelOpen ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
        onClick={() => setIsConversationPanelOpen(false)}
        aria-hidden="true"
      />

      {/* 会話一覧サイドパネル
          デスクトップ: w-0/w-64 の width トランジション
          モバイル: fixed ドロワー（translate による表示切り替え） */}
      <div
        className={`bg-sidebar border-r border-sidebar-border flex flex-col overflow-hidden transition-all duration-300 ease-in-out max-md:fixed max-md:inset-y-0 max-md:left-0 max-md:z-40 max-md:w-72 max-md:shadow-xl ${
          isConversationPanelOpen
            ? "md:w-64 md:opacity-100 max-md:translate-x-0"
            : "md:w-0 md:opacity-0 md:-translate-x-4 md:pointer-events-none md:border-r-0 max-md:-translate-x-full max-md:pointer-events-none"
        }`}
      >
        <div className="p-3 border-b border-sidebar-border">
          <button
            onClick={handleNewConversation}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-primary text-white rounded-lg text-sm hover:bg-primary-hover transition-colors"
          >
            <HiOutlinePlus className="w-4 h-4" />
            新しい会話
          </button>
        </div>
        {loadError && (
          <div className="mx-2 mt-2 rounded-lg border border-error/30 bg-error-light p-2 text-xs text-error">
            <p>{loadError}</p>
            <button
              type="button"
              onClick={loadConversations}
              className="mt-1 rounded-md border border-error/30 bg-white px-2 py-1 text-[11px]"
            >
              再試行
            </button>
          </div>
        )}
        <div className="flex-1 overflow-y-auto p-2 space-y-1">
          {conversations.map((conv) => (
            <div
              key={conv.id}
              className={`group flex items-center gap-1 px-3 py-2 rounded-lg text-sm cursor-pointer transition-colors ${
                activeConvId === conv.id
                  ? "bg-primary-light text-primary"
                  : "text-text-secondary hover:bg-hover"
              }`}
              onClick={() => handleSelectConversation(conv.id)}
            >
              <span className="flex-1 truncate">{conv.title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleDeleteConversation(conv.id);
                }}
                className="opacity-0 group-hover:opacity-100 p-1 text-text-muted hover:text-error transition-opacity"
              >
                <HiOutlineTrash className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      </div>

      <button
        onClick={() => setIsConversationPanelOpen((prev) => !prev)}
        aria-label={isConversationPanelOpen ? "会話一覧を隠す" : "会話一覧を表示"}
        className={`absolute top-3 z-20 h-8 w-6 border border-card-border border-l-0 bg-card text-text-secondary rounded-r-md hover:bg-hover hover:text-text transition-all duration-300 max-md:hidden ${
          isConversationPanelOpen ? "left-64" : "left-0"
        }`}
      >
        {isConversationPanelOpen ? (
          <HiChevronLeft className="mx-auto h-4 w-4" />
        ) : (
          <HiChevronRight className="mx-auto h-4 w-4" />
        )}
      </button>

      {/* チャットエリア */}
      <div className="flex-1 flex flex-col min-w-0 h-full">
        {activeConvId ? (
          <>
            {/* モバイル用会話パネルトグル */}
            <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-card-border bg-card shrink-0">
              <button
                type="button"
                onClick={() => setIsConversationPanelOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-card-border hover:bg-hover transition-colors"
              >
                <HiChevronRight className="w-3.5 h-3.5" />
                会話一覧
              </button>
              <button
                onClick={handleNewConversation}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs hover:bg-primary-hover transition-colors"
              >
                <HiOutlinePlus className="w-3.5 h-3.5" />
                新しい会話
              </button>
            </div>
            <div
              data-chat-messages-scroll-root
              ref={messagesViewportRef}
              onScroll={handleMessagesScroll}
              className="flex-1 overflow-y-auto p-4"
            >
              {messages.length === 0 && !streamingContent && (
                <EmptyState
                  icon="📐"
                  title="数学の質問をしてみましょう"
                  description="例: 「二次方程式の解き方を教えて」"
                  className="h-full"
                />
              )}
              {messages.map((msg) => (
                <ChatMessage
                  key={msg.id}
                  role={msg.role}
                  content={msg.content}
                />
              ))}
              {streamingContent && (
                <ChatMessage role="assistant" content={streamingContent} />
              )}
              {isLoading && !streamingContent && (
                <div className="flex justify-start mb-4">
                  <div className="bg-card border border-card-border rounded-2xl px-4 py-3">
                    <div className="flex gap-1">
                      <span className="w-2 h-2 bg-accent rounded-full animate-bounce" />
                      <span className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:0.1s]" />
                      <span className="w-2 h-2 bg-accent rounded-full animate-bounce [animation-delay:0.2s]" />
                    </div>
                  </div>
                </div>
              )}
            </div>
            <ChatInput onSend={handleSend} disabled={isLoading} />
          </>
        ) : (
          <>
            {/* モバイル用会話パネルトグル（会話未選択時） */}
            <div className="md:hidden flex items-center gap-2 px-3 py-2 border-b border-card-border bg-card shrink-0">
              <button
                type="button"
                onClick={() => setIsConversationPanelOpen(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-text-secondary border border-card-border hover:bg-hover transition-colors"
              >
                <HiChevronRight className="w-3.5 h-3.5" />
                会話一覧
              </button>
            </div>
            <EmptyState
              icon="🎓"
              title="Miramath"
              description="「新しい会話」をクリックして学習を始めましょう"
              actionLabel="学習を始める"
              onAction={handleNewConversation}
              className="flex-1"
            />
          </>
        )}
      </div>
    </div>
  );
}
