"use client";

import { lazy, Suspense, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Copy, Menu, Square, SquarePen } from "lucide-react";
import { ERROR_MARK, MAX_CHARS, MSG_GENERIC } from "@/lib/chat";
import { loadHistory, makeTitle, newId, saveHistory, type Conversation, type Msg } from "@/lib/history";
import Sidebar from "./Sidebar";

// Markdown is split into its own chunk so the page is ready to type before it loads.
const Markdown = lazy(() => import("./Markdown"));

const NO_MESSAGES: Msg[] = [];
const MSG_NETWORK = "אין חיבור לאינטרנט, או שהחיבור נקטע. נסו שוב.";
const MSG_EMPTY = "לא התקבלה תשובה. נסו שוב.";

const SUGGESTIONS = [
  "תציע לי מתכון פשוט לארוחת ערב",
  "תסביר לי במילים פשוטות מה זו ריבית דריבית",
  "עזור לי לנסח הודעה מנומסת לבעל הדירה",
  "תן לי רעיונות לטיול משפחתי בצפון",
];

function getStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null; // blocked (private mode, strict settings): chat works, nothing persists
  }
}

const DESKTOP = "(min-width: 1024px)";
const subscribeDesktop = (cb: () => void) => {
  const m = matchMedia(DESKTOP);
  m.addEventListener("change", cb);
  return () => m.removeEventListener("change", cb);
};

export default function Chat() {
  const [convs, setConvs] = useState<Conversation[] | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const stickRef = useRef(true);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);
  const drawerWasOpen = useRef(false);
  const router = useRouter();
  const isDesktop = useSyncExternalStore(subscribeDesktop, () => matchMedia(DESKTOP).matches, () => false);

  const active = convs?.find((c) => c.id === activeId);
  const messages = active?.messages ?? NO_MESSAGES;
  const modalDrawer = drawerOpen && !isDesktop;

  useEffect(() => {
    // localStorage only exists in the browser, so history loads after hydration.
    const h = loadHistory(getStorage());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConvs(h.conversations);
    setActiveId(h.activeId);
    if (matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!convs || streaming) return;
    const r = saveHistory(getStorage(), { activeId, conversations: convs });
    if (r.quotaPruned) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setConvs(r.history.conversations);
      setToast("האחסון התמלא, אז נמחקו השיחות הישנות ביותר.");
    } else if (!r.ok && r.history.conversations.length && getStorage()) {
      setToast("האחסון מלא. מחקו כמה שיחות כדי שהשיחה תישמר.");
    }
  }, [convs, activeId, streaming]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 4000);
    return () => clearTimeout(t);
  }, [toast]);

  // Mobile drawer: lock page scroll while open, and hand focus back to ☰ when it closes.
  useEffect(() => {
    if (!modalDrawer) return;
    const el = document.documentElement;
    el.style.overflow = "hidden";
    return () => {
      el.style.overflow = "";
    };
  }, [modalDrawer]);

  useEffect(() => {
    if (drawerWasOpen.current && !drawerOpen) menuBtnRef.current?.focus();
    drawerWasOpen.current = drawerOpen;
  }, [drawerOpen]);

  // Follow the answer while it streams, unless the user scrolled up to read.
  useEffect(() => {
    const onScroll = () => {
      const el = document.documentElement;
      stickRef.current = el.scrollHeight - window.scrollY - window.innerHeight < 80;
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  useEffect(() => {
    if (stickRef.current) window.scrollTo({ top: document.documentElement.scrollHeight });
  }, [messages]);

  // Auto-grow the textarea; CSS max-height caps it at 6 lines.
  useEffect(() => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = "auto";
    ta.style.height = `${ta.scrollHeight}px`;
  }, [input]);

  const updateConv = (id: string, fn: (c: Conversation) => Conversation) =>
    setConvs((cs) => cs && cs.map((c) => (c.id === id ? fn(c) : c)));

  // Aborts the in-flight answer; whatever streamed so far stays in its conversation.
  function stopStreaming() {
    const ctrl = abortRef.current;
    abortRef.current = null;
    ctrl?.abort();
    setStreaming(false);
  }

  async function send(raw: string) {
    const text = raw.trim();
    if (!text || streaming || !convs) return;

    const now = Date.now();
    const id = active?.id ?? newId();
    const history: Msg[] = [...messages, { role: "user", content: text }];
    const withAnswer: Msg[] = [...history, { role: "assistant", content: "" }];
    if (active) {
      updateConv(id, (c) => ({ ...c, updatedAt: now, messages: withAnswer }));
    } else {
      // A conversation only exists once its first message is sent.
      const c: Conversation = {
        id,
        title: makeTitle(text),
        createdAt: now,
        updatedAt: now,
        pinned: false,
        messages: withAnswer,
      };
      setConvs((cs) => cs && [c, ...cs]);
      setActiveId(id);
    }
    setInput("");
    setStreaming(true);
    stickRef.current = true;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Updates target this conversation by id, so switching away mid-stream is safe.
    const patchLast = (p: Partial<Msg>) =>
      updateConv(id, (c) => ({ ...c, messages: [...c.messages.slice(0, -1), { ...c.messages.at(-1)!, ...p }] }));

    let acc = "";
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: history
            .filter((m) => m.content && !m.error)
            .map(({ role, content }) => ({ role, content })),
        }),
        signal: ctrl.signal,
      });
      if (res.status === 401) {
        router.replace("/login");
        return;
      }
      if (!res.ok || !res.body) {
        const j = await res.json().catch(() => null);
        throw new Error(j?.error || MSG_GENERIC);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += decoder.decode(value, { stream: true });
        patchLast({ content: acc.split(ERROR_MARK)[0] });
      }

      const [answer, error] = acc.split(ERROR_MARK);
      if (error !== undefined) patchLast({ content: answer, error });
      else if (!answer.trim()) patchLast({ error: MSG_EMPTY });
      updateConv(id, (c) => ({ ...c, updatedAt: Date.now() }));
    } catch (e) {
      if (ctrl.signal.aborted) {
        // Stopped before any text arrived: drop the empty placeholder.
        if (!acc)
          updateConv(id, (c) => {
            const last = c.messages.at(-1);
            return last?.role === "assistant" && !last.content
              ? { ...c, messages: c.messages.slice(0, -1) }
              : c;
          });
      } else {
        patchLast({ error: e instanceof TypeError ? MSG_NETWORK : (e as Error).message || MSG_GENERIC });
      }
    } finally {
      if (abortRef.current === ctrl) {
        abortRef.current = null;
        setStreaming(false);
      }
    }
  }

  function newChat() {
    stopStreaming();
    setActiveId(null);
    setInput("");
    setDrawerOpen(false);
  }

  function selectConversation(id: string) {
    if (id !== activeId) {
      stopStreaming();
      setActiveId(id);
      stickRef.current = true;
    }
    setDrawerOpen(false);
  }

  function deleteConversation(id: string) {
    if (id === activeId) newChat();
    setConvs((cs) => cs && cs.filter((c) => c.id !== id));
  }

  const last = messages.length - 1;

  return (
    <div className="lg:flex">
      <Sidebar
          conversations={convs}
          activeId={activeId}
          open={drawerOpen}
          collapsed={collapsed}
          isDesktop={isDesktop}
          onClose={() => setDrawerOpen(false)}
          onCollapse={() => setCollapsed(true)}
          onNew={newChat}
          onSelect={selectConversation}
          onRename={(id, title) => updateConv(id, (c) => ({ ...c, title }))}
          onTogglePin={(id) => updateConv(id, (c) => ({ ...c, pinned: !c.pinned }))}
          onDelete={deleteConversation}
        />

      <div inert={modalDrawer} className="flex min-h-dvh min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-10 bg-bg pt-[env(safe-area-inset-top)]">
          <div className="mx-auto flex h-14 max-w-3xl items-center justify-between ps-2 pe-3">
            <div className="flex items-center gap-1">
              <button
                ref={menuBtnRef}
                type="button"
                onClick={() => (isDesktop ? setCollapsed(false) : setDrawerOpen(true))}
                aria-label="היסטוריית שיחות"
                aria-expanded={isDesktop ? !collapsed : drawerOpen}
                title="היסטוריית שיחות"
                className={`press flex size-10 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] hover:bg-bubble hover:text-fg ${
                  collapsed ? "" : "lg:hidden"
                }`}
              >
                <Menu size={21} aria-hidden />
              </button>
              <h1 className="ps-2 text-[17px] font-semibold tracking-tight">צ׳אט AI</h1>
            </div>
            <button
              type="button"
              onClick={newChat}
              disabled={!activeId}
              className={`press flex h-10 items-center gap-2 rounded-full px-3 text-[15px] text-muted transition-[background-color,color,opacity,transform] hover:bg-bubble hover:text-fg disabled:opacity-0 ${
                collapsed ? "" : "lg:hidden"
              }`}
            >
              <SquarePen size={18} aria-hidden />
              שיחה חדשה
            </button>
          </div>
        </header>

        <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col px-4 sm:px-6">
          {convs && messages.length === 0 && (
            <div className="my-auto py-10">
              <h2 className="mb-6 text-[26px] font-semibold tracking-tight">במה אפשר לעזור?</h2>
              <div className="grid gap-2.5 sm:grid-cols-2">
                {SUGGESTIONS.map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => send(s)}
                    className="press rounded-2xl border border-line bg-surface px-4 py-3 text-start leading-snug transition-[background-color,border-color,transform] hover:border-muted/40"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.length > 0 && (
            <div key={activeId} className="space-y-7 pt-3 pb-8" aria-live="polite">
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="msg-in flex justify-start">
                    <div
                      dir="auto"
                      className="max-w-[85%] rounded-3xl bg-bubble px-4 py-2.5 wrap-break-word whitespace-pre-wrap"
                    >
                      {m.content}
                    </div>
                  </div>
                ) : (
                  <div key={i} className="msg-in">
                    {m.content ? (
                      <div dir="auto" className="break-words">
                        <Suspense fallback={<div className="whitespace-pre-wrap">{m.content}</div>}>
                          <Markdown text={m.content} />
                        </Suspense>
                      </div>
                    ) : (
                      !m.error && <TypingDots />
                    )}
                    {m.error && (
                      <p role="alert" className="mt-2 text-danger">
                        {m.error}
                      </p>
                    )}
                    {m.content && !(streaming && i === last) && <CopyButton text={m.content} />}
                  </div>
                ),
              )}
            </div>
          )}
        </main>

        <div className="sticky bottom-0 z-10 bg-bg pb-[max(env(safe-area-inset-bottom),0.75rem)] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-bg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="mx-auto max-w-3xl px-3 sm:px-5"
          >
            <div className="flex items-end gap-2 rounded-[1.75rem] border border-line bg-surface p-2 ps-4 shadow-[0_1px_8px_rgb(0_0_0/0.04)] transition-[border-color] focus-within:border-muted/50">
              <textarea
                ref={inputRef}
                rows={1}
                // Empty: RTL so caret and placeholder sit on the right. Typed: follow the text.
                dir={input ? "auto" : "rtl"}
                value={input}
                maxLength={MAX_CHARS}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  // Desktop: Enter sends, Shift+Enter is a newline. Touch: Enter is a newline.
                  if (
                    e.key === "Enter" &&
                    !e.shiftKey &&
                    !e.nativeEvent.isComposing &&
                    !matchMedia("(pointer: coarse)").matches
                  ) {
                    e.preventDefault();
                    send(input);
                  }
                }}
                placeholder="שאלו כל דבר…"
                aria-label="הודעה"
                className="max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 leading-6 outline-none placeholder:text-muted"
              />
              {streaming ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  aria-label="עצירה"
                  title="עצירה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-transform"
                >
                  <Square size={14} fill="currentColor" aria-hidden />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={!input.trim() || !convs}
                  aria-label="שליחה"
                  title="שליחה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-[opacity,transform] disabled:opacity-30"
                >
                  <ArrowUp size={20} strokeWidth={2.25} aria-hidden />
                </button>
              )}
            </div>
          </form>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className="fade-in fixed inset-x-0 top-[calc(env(safe-area-inset-top)+0.75rem)] z-50 mx-auto w-fit max-w-[calc(100%-2rem)] rounded-2xl bg-fg px-4 py-2.5 text-[15px] text-bg shadow-lg"
        >
          {toast}
        </div>
      )}
    </div>
  );
}

function TypingDots() {
  return (
    <div role="status" aria-label="מקליד…" className="dots flex h-7 items-center gap-1.5 text-muted">
      <span />
      <span />
      <span />
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: nothing useful to show
    }
  }

  return (
    <button
      type="button"
      onClick={copy}
      aria-label={copied ? "הועתק" : "העתקה"}
      title={copied ? "הועתק" : "העתקה"}
      className="press -ms-2 mt-1.5 flex size-9 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] hover:bg-bubble hover:text-fg"
    >
      {copied ? <Check size={17} aria-hidden /> : <Copy size={17} aria-hidden />}
    </button>
  );
}
