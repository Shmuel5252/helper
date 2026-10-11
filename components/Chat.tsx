"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Copy, ImagePlus, Menu, Square, SquarePen, X } from "lucide-react";
import { ERROR_MARK, MAX_CHARS, MSG_GENERIC, prepareHistory } from "@/lib/chat";
import { loadHistory, makeTitle, newId, saveHistory, type Conversation, type Msg } from "@/lib/history";
import { IMAGE_ERRORS, MAX_BODY_BYTES, MAX_IMAGES } from "@/lib/images";
import type { PublicModel } from "@/lib/models";
import ModelPicker from "./ModelPicker";
import Sidebar from "./Sidebar";

// Markdown is split into its own chunk so the page is ready to type before it loads.
const Markdown = lazy(() => import("./Markdown"));

// Image resizing code loads on the first attach, not with the page.
type Processor = typeof import("@/lib/imageProcess");
let processor: Promise<Processor> | null = null;
const loadProcessor = () => (processor ??= import("@/lib/imageProcess"));
const MSG_IMAGE_FAILED = "לא הצלחנו לעבד את התמונה. נסו שוב או בחרו תמונה אחרת.";

// A slot is added per picked file (in pick order) and filled once processing finishes.
type Attachment = { id: string; thumb?: string; full?: string };

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

// The model option the user picked last; new conversations start with it.
const MODEL_KEY = "ai-chat:model";

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
  const [models, setModels] = useState<PublicModel[] | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
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

  // This conversation's model option (new chat: the last one picked). Keys that are no longer
  // on the server's list fall back silently to the default (first) option.
  const wantedKey = active ? active.modelKey : (lastKey ?? undefined);
  const currentKey = !models || models.some((m) => m.key === wantedKey) ? wantedKey : models[0]?.key;
  const labelOf = (key?: string) => (models && models.length > 1 ? models.find((m) => m.key === key)?.label : undefined);
  // Images only for options that accept them; otherwise the attach button is hidden.
  const canAttach = !!models?.find((m) => m.key === currentKey)?.vision;
  const shown = canAttach ? attachments : []; // hidden (and not sent) for text-only options
  const pending = shown.filter((a): a is Required<Attachment> => !!a.full);
  const processing = shown.length - pending.length;
  const closeViewer = useCallback(() => setViewer(null), []);

  async function addImages(files: File[]) {
    const room = MAX_IMAGES - attachments.length;
    if (files.length > room) setToast(IMAGE_ERRORS.count);
    const slots = files.slice(0, Math.max(0, room)).map((file) => ({ file, id: newId() }));
    if (!slots.length) return;
    setAttachments((a) => [...a, ...slots.map(({ id }) => ({ id }))]);
    const drop = (id: string) => setAttachments((a) => a.filter((x) => x.id !== id));
    let lib: Processor;
    try {
      lib = await loadProcessor();
    } catch {
      processor = null; // retry the download next time
      slots.forEach(({ id }) => drop(id));
      setToast(MSG_IMAGE_FAILED);
      return;
    }
    await Promise.all(
      slots.map(async ({ file, id }) => {
        try {
          const img = await lib.prepareImage(file);
          setAttachments((a) => a.map((x) => (x.id === id ? { id, ...img } : x)));
        } catch (e) {
          drop(id);
          setToast(e instanceof lib.ImageError ? e.message : MSG_IMAGE_FAILED);
        }
      }),
    );
  }

  useEffect(() => {
    // localStorage only exists in the browser, so history loads after hydration.
    const h = loadHistory(getStorage());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConvs(h.conversations);
    setActiveId(h.activeId);
    setLastKey(getStorage()?.getItem(MODEL_KEY) ?? null);
    if (matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => Array.isArray(j?.models) && setModels(j.models))
      .catch(() => {}); // no list: no picker, the server uses its default
  }, []);

  function chooseModel(key: string) {
    setLastKey(key);
    try {
      getStorage()?.setItem(MODEL_KEY, key);
    } catch {
      // not remembered across reloads; fine
    }
    // Mid-conversation: applies from the next message.
    if (active) updateConv(active.id, (c) => ({ ...c, modelKey: key }));
  }

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
    const imgs = pending;
    if ((!text && !imgs.length) || streaming || !convs || processing) return;

    const now = Date.now();
    const id = active?.id ?? newId();
    const modelKey = currentKey;
    const userMsg: Msg = imgs.length
      ? { role: "user", content: text, images: imgs.map((a) => a.thumb), full: imgs.map((a) => a.full) }
      : { role: "user", content: text };
    const history: Msg[] = [...messages, userMsg];
    const withAnswer: Msg[] = [...history, { role: "assistant", content: "", modelKey }];
    if (active) {
      updateConv(id, (c) => ({ ...c, updatedAt: now, messages: withAnswer, modelKey }));
    } else {
      // A conversation only exists once its first message is sent.
      const c: Conversation = {
        id,
        title: makeTitle(text || "תמונה"),
        createdAt: now,
        updatedAt: now,
        pinned: false,
        messages: withAnswer,
        modelKey,
      };
      setConvs((cs) => cs && [c, ...cs]);
      setActiveId(id);
    }
    setInput("");
    if (imgs.length) setAttachments([]);
    setStreaming(true);
    stickRef.current = true;

    const ctrl = new AbortController();
    abortRef.current = ctrl;
    // Updates target this conversation by id, so switching away mid-stream is safe.
    const patchLast = (p: Partial<Msg>) =>
      updateConv(id, (c) => ({ ...c, messages: [...c.messages.slice(0, -1), { ...c.messages.at(-1)!, ...p }] }));

    let acc = "";
    try {
      // Same shaping as the server: only the newest image message carries image data
      // (full size if still in memory, else its thumbnail); older ones become a placeholder.
      const payload = prepareHistory(
        history
          .filter((m) => !m.error && (m.content || m.images?.length))
          .map((m) => ({ role: m.role, content: m.content, images: m.full ?? m.images })),
        { vision: canAttach },
      );
      const body = JSON.stringify({ messages: payload, modelKey });
      if (body.length > MAX_BODY_BYTES) throw new Error(IMAGE_ERRORS.body);
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
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
        {/* z-20: above the sticky composer, so the model sheet's overlay covers it. */}
        <header className="sticky top-0 z-20 bg-bg pt-[env(safe-area-inset-top)]">
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
              <h1 className="ps-2 pe-1 text-[17px] font-semibold tracking-tight">צ׳אט AI</h1>
              {models && models.length > 1 && (
                <ModelPicker models={models} value={currentKey} onChange={chooseModel} />
              )}
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
                  <div key={i} className="msg-in flex flex-col items-start gap-1.5">
                    {!!m.images?.length && (
                      <div className="flex max-w-[85%] flex-wrap gap-1.5">
                        {m.images.map((src, j) => (
                          <button
                            key={j}
                            type="button"
                            onClick={() => setViewer(m.full?.[j] ?? src)}
                            aria-label={`הגדלת תמונה ${j + 1}`}
                            className="press overflow-hidden rounded-2xl bg-bubble transition-transform"
                          >
                            <Img src={m.full?.[j] ?? src} alt="" className="size-28 object-cover" />
                          </button>
                        ))}
                      </div>
                    )}
                    {m.content && (
                      <div
                        dir="auto"
                        className="max-w-[85%] rounded-3xl bg-bubble px-4 py-2.5 wrap-break-word whitespace-pre-wrap"
                      >
                        {m.content}
                      </div>
                    )}
                  </div>
                ) : (
                  <div key={i} className="msg-in">
                    {m.content ? (
                      <div dir="auto" className="wrap-break-word">
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
                    {m.content && !(streaming && i === last) && (
                      <div className="mt-1.5 flex items-center gap-1">
                        <CopyButton text={m.content} />
                        {labelOf(m.modelKey) && (
                          <span className="text-[13px] text-muted" title="המודל שענה">
                            {labelOf(m.modelKey)}
                          </span>
                        )}
                      </div>
                    )}
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
            <div className="rounded-[1.75rem] border border-line bg-surface p-2 shadow-[0_1px_8px_rgb(0_0_0/0.04)] transition-[border-color] focus-within:border-muted/50">
              {shown.length > 0 && (
                <div className="flex gap-2.5 px-1.5 pt-1.5 pb-2.5">
                  {shown.map((a, i) => (
                    <div key={a.id} className="fade-in relative size-16 shrink-0">
                      {a.thumb ? (
                        <Img src={a.thumb} alt={`תמונה מצורפת ${i + 1}`} className="size-16 rounded-xl object-cover" />
                      ) : (
                        <div role="status" aria-label="מעבד תמונה…" className="size-16 animate-pulse rounded-xl bg-bubble" />
                      )}
                      <button
                        type="button"
                        onClick={() => setAttachments((list) => list.filter((x) => x.id !== a.id))}
                        aria-label={`הסרת תמונה ${i + 1}`}
                        title="הסרה"
                        className="press absolute -inset-s-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-fg text-bg shadow transition-transform"
                      >
                        <X size={14} strokeWidth={2.5} aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <div className="flex items-end gap-1.5">
              {canAttach && (
                <button
                  type="button"
                  onClick={() => {
                    void loadProcessor().catch(() => {}); // start downloading while the picker is open
                    fileRef.current?.click();
                  }}
                  disabled={attachments.length >= MAX_IMAGES}
                  aria-label="צירוף תמונה"
                  title="צירוף תמונה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-[background-color,color,opacity,transform] hover:bg-bubble hover:text-fg disabled:opacity-35"
                >
                  <ImagePlus size={21} aria-hidden />
                </button>
              )}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                multiple
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = ""; // picking the same file again should still fire
                  void addImages(files);
                }}
              />
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
                className={`max-h-40 min-w-0 flex-1 resize-none bg-transparent py-2 leading-6 outline-none placeholder:text-muted ${
                  canAttach ? "ps-0.5" : "ps-2"
                }`}
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
                  disabled={(!input.trim() && !pending.length) || !convs || processing > 0}
                  aria-label="שליחה"
                  title="שליחה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-[opacity,transform] disabled:opacity-30"
                >
                  <ArrowUp size={20} strokeWidth={2.25} aria-hidden />
                </button>
              )}
              </div>
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

      {viewer && <ImageViewer src={viewer} onClose={closeViewer} />}
    </div>
  );
}

// Images here are local data URLs (never remote), so next/image's optimizer has nothing to add.
function Img({ src, alt, className }: { src: string; alt: string; className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt={alt} className={className} decoding="async" draggable={false} />;
}

// Full-screen view of a sent image. Tap anywhere or Escape closes it.
function ImageViewer({ src, onClose }: { src: string; onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="תצוגת תמונה"
      onClick={onClose}
      className="fade-in fixed inset-0 z-50 flex items-center justify-center bg-black/90 p-4 pt-[max(env(safe-area-inset-top),1rem)] pb-[max(env(safe-area-inset-bottom),1rem)]"
    >
      <Img src={src} alt="תמונה שצורפה" className="max-h-full max-w-full rounded-lg object-contain" />
      <button
        ref={closeRef}
        type="button"
        aria-label="סגירת התמונה"
        title="סגירה"
        className="press absolute inset-s-3 top-[calc(env(safe-area-inset-top)+0.75rem)] flex size-10 items-center justify-center rounded-full bg-white/15 text-white transition-transform"
      >
        <X size={22} aria-hidden />
      </button>
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
      className="press -ms-2 flex size-9 items-center justify-center rounded-full text-muted transition-[background-color,color,transform] hover:bg-bubble hover:text-fg"
    >
      {copied ? <Check size={17} aria-hidden /> : <Copy size={17} aria-hidden />}
    </button>
  );
}
