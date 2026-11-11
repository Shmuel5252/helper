"use client";

import { lazy, Suspense, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { ArrowUp, Check, Copy, ImagePlus, Menu, Paperclip, Square, SquarePen, X } from "lucide-react";
import { ERROR_MARK, MAX_CHARS, MSG_GENERIC, prepareHistory } from "@/lib/chat";
import {
  DEFAULT_DOC_PROMPT,
  DOC_ACCEPT,
  DOC_ERRORS,
  DOC_PRIVACY_NOTE,
  DOC_SUGGESTIONS,
  docMarker,
  pickAttachments,
  type DocAttachment,
} from "@/lib/documents";
import { loadHistory, makeTitle, mediaAsText, newId, saveHistory, type Conversation, type MediaResult, type Msg } from "@/lib/history";
import { IMAGE_ERRORS, MAX_BODY_BYTES, MAX_IMAGES } from "@/lib/images";
import type { PublicModel } from "@/lib/models";
import type { PublicMediaOption } from "@/lib/openart/media-config";
import { loadExhausted, markExhausted, type Exhausted } from "@/lib/quota";
import DocChip from "./DocChip";
import MediaCard from "./MediaCard";
import ModelPicker from "./ModelPicker";
import ModeSwitch, { type Mode } from "./ModeSwitch";
import Sidebar from "./Sidebar";
import { useMediaPolling } from "./useMediaPolling";
import { ImageAdvanced, RealisticImageCard, useRealisticPolling } from "./RealisticImage";
import { sameSeedIntent, usesDirectImagePrompt, type ImageConfig, type ImageOverrides, type ImageSubmission } from "@/lib/realistic-image";
import { requestJson as imageApi } from "@/lib/gemini-progress";
import { watchUpdates } from "@/lib/gemini-polling";

// Markdown is split into its own chunk so the page is ready to type before it loads.
const Markdown = lazy(() => import("./Markdown"));

// Image resizing code loads on the first attach, not with the page.
type Processor = typeof import("@/lib/imageProcess");
let processor: Promise<Processor> | null = null;
const loadProcessor = () => (processor ??= import("@/lib/imageProcess"));
const MSG_IMAGE_FAILED = "לא הצלחנו לעבד את התמונה. נסו שוב או בחרו תמונה אחרת.";

// A slot is added per picked file (in pick order) and filled once processing finishes.
type Attachment = { id: string; thumb?: string; full?: string };

// OpenArt generation (image/video), from /api/media/config.
type Usage = { spent: number; cap: number | null; remaining: number | null }; // cap null = no daily limit
type MediaConfig = { configured: boolean; available: boolean; image: PublicMediaOption[]; video: PublicMediaOption[]; usage: Usage | null };
type Quote = { sig: string; credits?: number; remaining?: number | null; cap?: number | null; affordable?: boolean; error?: string };
const MSG_MEDIA_UNAVAILABLE = "יצירת תמונות וסרטונים לא זמינה כרגע.";
const DEFAULT_ANIMATE_PROMPT = "הנפש את התמונה בתנועה טבעית";
const PLACEHOLDERS: Record<Mode, string> = { chat: "שאלו כל דבר…", image: "תארו את התמונה…", video: "תארו את הסרטון…" };

// The composer chip lists OpenArt options with the same picker as chat models.
const NO_EXHAUSTED: Exhausted = {};
const asPickerModel = (o: PublicMediaOption): PublicModel => ({ ...o, vision: false, group: o.key });
type ImageProvider = "openart" | "realistic";
const IMAGE_PROVIDER_KEY = "ai-chat:image-provider";
const IMAGE_PROVIDERS: PublicModel[] = [
  { key: "openart", label: "OpenArt", description: "יצירה באמצעות החשבון · עם קרדיטים", modelName: "", vision: false, group: "openart" },
  { key: "realistic", label: "Realistic Vision", description: "יצירת תמונות ללא קרדיטי OpenArt", modelName: "", vision: false, group: "realistic" },
];

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
const DOC_NOTE_KEY = "ai-chat:doc-note-seen"; // the privacy line shows once

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
  // A document waiting in the composer (chat mode): parsed is missing while /api/parse runs.
  const [doc, setDoc] = useState<{ id: string; name: string; size: number; parsed?: DocAttachment } | null>(null);
  const [docNoteSeen, setDocNoteSeen] = useState(true);
  const [models, setModels] = useState<PublicModel[] | null>(null);
  const [lastKey, setLastKey] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [viewer, setViewer] = useState<string | null>(null);
  // Model groups whose daily quota ran out, until their reset time. `now` ticks once a minute.
  const [exhausted, setExhausted] = useState<Exhausted>({});
  const [now, setNow] = useState(0);
  const [attention, setAttention] = useState(0);
  // Image/video generation state.
  const [mode, setMode] = useState<Mode>("chat");
  const [imageProvider, setImageProvider] = useState<ImageProvider>("openart");
  const [imageCfg, setImageCfg] = useState<ImageConfig | null>(null);
  const [imageSettings, setImageSettings] = useState<ImageOverrides>({});
  const [imageSubmitting, setImageSubmitting] = useState(false);
  const imageSending = useRef(false);
  const [mediaCfg, setMediaCfg] = useState<MediaConfig | null>(null);
  const [mediaKeys, setMediaKeys] = useState<Partial<Record<"image" | "video", string>>>({});
  const [sourceRef, setSourceRef] = useState<string | null>(null); // a previous result (/media/...) to edit or animate
  const [quote, setQuote] = useState<Quote | null>(null);
  const [quoteNonce, setQuoteNonce] = useState(0);
  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null); // images
  const docRef = useRef<HTMLInputElement>(null); // documents (chat mode)
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
  const showPicker = !!models && models.length > 1;
  // The option that produced an answer (for the small label under it); only when there's a choice.
  const answeredBy = (key?: string) => (showPicker ? models.find((m) => m.key === key) : undefined);
  // Image/video mode: OpenArt options, the chosen one, an optional reference image, a live quote.
  const mediaMode = mode !== "chat";
  const realisticMode = mode === "image" && imageProvider === "realistic";
  const openArtMode = mediaMode && !realisticMode;
  const imagePending = messages.some(m => m.media?.provider === "realistic" && m.media.status === "pending");
  const mediaOptions = mode === "chat" || realisticMode ? [] : (mediaCfg?.[mode] ?? []);
  const mediaKey = mode === "chat" ? undefined : mediaOptions.some((o) => o.key === mediaKeys[mode]) ? mediaKeys[mode] : mediaOptions[0]?.key;
  const mediaOption = mediaOptions.find((o) => o.key === mediaKey);
  const mediaReady = realisticMode ? !!imageCfg?.enabled : openArtMode && !!mediaCfg?.available && !!mediaOption;

  // Images only for options that accept them; otherwise the attach button is hidden.
  // Generation always accepts one reference image (edit / start frame).
  // Chat mode always attaches documents; images only on options that accept them.
  const vision = !!models?.find((m) => m.key === currentKey)?.vision;
  const canAttach = realisticMode ? imageCfg?.mode === "cloud" && imageCfg.enabled : mediaMode ? !!mediaCfg?.available : true;
  const showImages = mediaMode ? canAttach : vision;
  const shown = !showImages ? [] : mediaMode ? attachments.slice(0, 1) : attachments; // hidden (and not sent) otherwise
  const pendingDoc = mediaMode ? null : doc; // kept, but not offered, in image/video mode
  const docParsing = !!pendingDoc && !pendingDoc.parsed;
  const pending = shown.filter((a): a is Required<Attachment> => !!a.full);
  const processing = shown.length - pending.length;
  const refImage = !mediaMode ? null : sourceRef ? { source: sourceRef, thumb: sourceRef } : pending[0] ? { dataUrl: pending[0].full, thumb: pending[0].thumb } : null;
  const closeViewer = useCallback(() => setViewer(null), []);

  // The quote belongs to (mode, option, reference?): a stale one counts as "loading".
  const quoteSig = openArtMode && mediaReady ? `${mode}|${mediaKey}|${refImage ? 1 : 0}|${quoteNonce}` : null;
  const q = quote && quote.sig === quoteSig ? quote : null;
  const mediaPrompt = (realisticMode ? imageSettings.prompt ?? input : input).trim() || (mode === "video" && refImage ? DEFAULT_ANIMATE_PROMPT : "");
  const overCap = !!q?.credits && q.remaining != null && q.credits > q.remaining;
  const canGenerate = mediaReady && !!mediaPrompt && !processing && (realisticMode
    ? !imageSubmitting && !streaming && !imagePending
    : !!q?.credits && !q.error && q.affordable !== false && !overCap);
  // Spending needs two taps: the first arms it for exactly this request, any change disarms it.
  const confirmSig = `${quoteSig}|${input}|${refImage?.thumb.slice(-24) ?? ""}`;
  const confirming = canGenerate && confirmFor === confirmSig;
  const mediaInfo = realisticMode
    ? !imageCfg?.enabled ? "שרת התמונות לא זמין" : imageSubmitting ? "שולח את הבקשה…" : imagePending ? "הבקשה הקודמת עדיין בטיפול." : imageCfg.worker === "offline" ? "ממתין לשרת התמונות" : ""
    : !mediaCfg?.available
    ? MSG_MEDIA_UNAVAILABLE
    : !q
      ? "מחשב מחיר…"
      : q.error
        ? q.error
        : q.affordable === false
          ? "אין מספיק קרדיטים בחשבון ה-OpenArt."
          : overCap
            ? `הגעתם לתקרה היומית של ${q.cap} קרדיטים. אפשר לנסות שוב מחר.`
            : `${q.credits} קרדיטים${q.cap != null ? ` · נותרו היום ${q.remaining} מתוך ${q.cap}` : ""}${confirming ? " · הקישו שוב לאישור" : ""}`;
  const mediaInfoWarn = realisticMode ? !imageCfg?.enabled : !mediaCfg?.available || !!q?.error || q?.affordable === false || overCap;
  // Narrow screens: the textarea gets its own row whenever the buttons row would be crowded.
  const twoRow = showPicker || mediaMode || !!mediaCfg?.configured;

  useEffect(() => {
    if (!quoteSig) return;
    let off = false;
    const [kind, key, withImage] = quoteSig.split("|");
    fetch("/api/media/quote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ kind, key, withImage: withImage === "1" }),
    })
      .then(async (r) => ({ ok: r.ok, body: await r.json().catch(() => null) }))
      .then(({ ok, body }) => !off && setQuote(ok ? { sig: quoteSig, ...body } : { sig: quoteSig, error: body?.error ?? MSG_GENERIC }))
      .catch(() => !off && setQuote({ sig: quoteSig, error: MSG_NETWORK }));
    return () => {
      off = true;
    };
  }, [quoteSig]);

  const refreshMedia = useCallback(() => {
    fetch("/api/media/config")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => j && typeof j.configured === "boolean" && setMediaCfg(j))
      .catch(() => {});
  }, []);

  const updateMedia = useCallback(
    (jobId: string, patch: Partial<MediaResult>) =>
      setConvs((cs) =>
        cs &&
        cs.map((c) =>
          c.messages.some((m) => m.media?.jobId === jobId)
            ? { ...c, messages: c.messages.map((m) => (m.media?.jobId === jobId ? { ...m, media: { ...m.media, ...patch } } : m)) }
            : c,
        ),
      ),
    [],
  );
  const polling = useMediaPolling(convs, updateMedia, refreshMedia);
  useRealisticPolling(convs, updateMedia);
  useEffect(() => watchUpdates(async () => {
    try { setImageCfg(await imageApi<ImageConfig>("/api/images/config")); } catch { /* Keep the last known state during a disconnect. */ }
  }, window, document, 30000), []);

  function chooseImageProvider(key: string) {
    if (key !== "openart" && key !== "realistic") return;
    setImageProvider(key);
    setConfirmFor(null);
    try { getStorage()?.setItem(IMAGE_PROVIDER_KEY, key); } catch { /* Selection still works without storage. */ }
  }

  function switchMode(next: Mode) {
    setMode(next);
    if (next === "chat") setSourceRef(null);
  }

  // From a result's buttons: edit it, or use it as a video's first frame.
  function takeAsReference(url: string, next: "image" | "video", provider: ImageProvider = "openart") {
    setMode(next);
    if (next === "image") chooseImageProvider(provider);
    setSourceRef(url);
    setAttachments([]);
    inputRef.current?.focus();
  }

  async function addImages(files: File[]) {
    if (mediaMode) setSourceRef(null); // a fresh attachment replaces a previous-result reference
    const room = (mediaMode ? 1 : MAX_IMAGES) - attachments.length;
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

  // Chat mode: images or one document per message (see pickAttachments).
  function addFiles(files: File[]) {
    const r = pickAttachments(files, { current: attachments.length ? "images" : pendingDoc ? "doc" : null, vision });
    if (r.error) setToast(r.error);
    if (r.kind === "images") void addImages(r.files);
    else if (r.kind === "doc") void attachDoc(r.files[0]);
  }

  async function attachDoc(file: File) {
    const id = newId();
    setDoc({ id, name: file.name, size: file.size }); // a new document replaces a pending one
    const drop = (error: string) => {
      setDoc((d) => (d?.id === id ? null : d));
      setToast(error);
    };
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/parse", { method: "POST", body: form });
      if (res.status === 401) return router.replace("/login");
      const body = await res.json().catch(() => null);
      if (!res.ok || typeof body?.text !== "string") return drop(body?.error ?? DOC_ERRORS.failed);
      setDoc((d) => (d?.id === id ? { ...d, parsed: body as DocAttachment } : d));
    } catch {
      drop(MSG_NETWORK);
    }
  }

  const dismissDocNote = () => {
    setDocNoteSeen(true);
    try {
      getStorage()?.setItem(DOC_NOTE_KEY, "1");
    } catch {
      // storage blocked: it just shows again next time
    }
  };

  useEffect(() => {
    // localStorage only exists in the browser, so history loads after hydration.
    const h = loadHistory(getStorage());
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setConvs(h.conversations);
    setActiveId(h.activeId);
    setLastKey(getStorage()?.getItem(MODEL_KEY) ?? null);
    setDocNoteSeen(getStorage()?.getItem(DOC_NOTE_KEY) === "1");
    setImageProvider(getStorage()?.getItem(IMAGE_PROVIDER_KEY) === "realistic" ? "realistic" : "openart");
    const t = Date.now();
    setNow(t);
    setExhausted(loadExhausted(getStorage(), t));
    if (matchMedia("(pointer: fine)").matches) inputRef.current?.focus();
    fetch("/api/models")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => Array.isArray(j?.models) && setModels(j.models))
      .catch(() => {}); // no list: no picker, the server uses its default
    refreshMedia();
  }, [refreshMedia]);

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

  // Keep "renews in X hours" current, and drop badges once a quota resets.
  useEffect(() => {
    const id = setInterval(() => {
      const t = Date.now();
      setNow(t);
      setExhausted(loadExhausted(getStorage(), t));
    }, 60_000);
    return () => clearInterval(id);
  }, []);

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

  // Cancel/resume before the job id arrived: by position. The id patched in later keeps the
  // status, and polling only follows "pending" cards.
  const setMediaStatusAt = (index: number, status: "stopped" | "pending") =>
    activeId &&
    updateConv(activeId, (c) => ({
      ...c,
      messages: c.messages.map((m, i) => (i === index && m.media ? { ...m, media: { ...m.media, status } } : m)),
    }));

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
    const d = pendingDoc?.parsed;
    if ((!text && !imgs.length && !d) || streaming || !convs || processing || docParsing) return;

    const now = Date.now();
    const id = active?.id ?? newId();
    const modelKey = currentKey;
    const userMsg: Msg = d
      ? { role: "user", content: text || DEFAULT_DOC_PROMPT, doc: d }
      : imgs.length
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
        title: makeTitle(text || d?.name || "תמונה"),
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
    if (d) {
      setDoc(null);
      if (!docNoteSeen) dismissDocNote();
    }
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
      // Generated images/videos go to the chat model as a short text line, and references to
      // earlier results (/media/...) aren't sent as images.
      const payload = prepareHistory(
        history
          .filter((m) => (!m.privateImage || imageCfg?.promptAI) && !m.error && (m.content || m.images?.length || m.media?.status === "done"))
          .map((m) =>
            m.media
              ? { role: m.role, content: mediaAsText(m.media) }
              : m.doc
                ? { role: m.role, content: `${docMarker(m.doc.name)}\n${m.content}` }
                : { role: m.role, content: m.content, images: (m.full ?? m.images)?.filter((s) => s.startsWith("data:")) },
          ),
        { vision },
      );
      // The conversation's latest document travels with every request, for follow-up questions.
      const lastDoc = history.findLast((m) => m.doc)?.doc;
      const body = JSON.stringify({ messages: payload, modelKey, document: lastDoc && { name: lastDoc.name, text: lastDoc.text } });
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
        // Daily quota used up: mark that model group in the picker. Never switch automatically.
        if (typeof j?.quota?.group === "string" && typeof j.quota.resetAt === "number") {
          const t = Date.now();
          setNow(t);
          setExhausted(markExhausted(getStorage(), j.quota.group, j.quota.resetAt, t));
          if (j.quota.group === models?.find((m) => m.key === modelKey)?.group) setAttention((n) => n + 1);
        }
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

  async function submitRealistic(request: ImageSubmission) {
    try {
      const response = await fetch("/api/images/jobs", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(request),
      });
      const result = await response.json();
      if (!response.ok) {
        updateMedia(request.id, { status: "failed", submission: undefined, error: result.error || "יצירת התמונה לא זמינה." });
        return;
      }
      updateMedia(request.id, { status: result.status, originalRequest: result.originalRequest, settings: result.settings, url: result.url, statusText: result.statusText, error: result.error, submission: undefined });
    } catch {
      updateMedia(request.id, { statusText: "החיבור נקטע; בודק אם הבקשה נשמרה…", submission: request });
    }
  }

  async function retryRealistic(request: ImageSubmission) {
    if (imageSending.current) return;
    imageSending.current = true; setImageSubmitting(true);
    try { await submitRealistic(request); } finally { imageSending.current = false; setImageSubmitting(false); }
  }

  async function generateRealistic(raw: string, previous?: MediaResult, reuse = sameSeedIntent(raw), settings: ImageOverrides = imageSettings) {
    const text = usesDirectImagePrompt(settings) || settings.promptMode === "translate" ? (raw.trim() ? raw : settings.prompt ?? raw) : raw.trim();
    if (!text.trim() || !convs || imageSending.current || streaming || imagePending || processing) return;
    if (!imageCfg?.enabled) { setToast("שרת התמונות לא זמין"); return; }
    imageSending.current = true; setImageSubmitting(true);
    try {
      const timestamp = Date.now(), id = active?.id ?? newId(), jobId = crypto.randomUUID();
      const c = active ?? { id, title: makeTitle(text), createdAt: timestamp, updatedAt: timestamp, pinned: false, messages: [], modelKey: currentKey };
      let conversationId: string | undefined, sourceAssetId: string | undefined;
      if (refImage) {
        if (imageCfg.mode !== "cloud") throw Error("עריכת תמונה דורשת אחסון פרטי פעיל.");
        conversationId = jobId;
        await imageApi("/api/gemini/conversations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: conversationId, title: makeTitle(text) }) });
        const source = await fetch(refImage.source ?? refImage.dataUrl!);
        if (!source.ok) throw Error("לא הצלחנו לצרף את התמונה.");
        const blob = await source.blob();
        const form = new FormData();
        form.set("conversationId", conversationId);
        form.set("file", new File([blob], "image.jpg", { type: blob.type }));
        sourceAssetId = (await imageApi<{ id: string }>("/api/gemini/assets", { method: "POST", body: form })).id;
      }
      const submission: ImageSubmission = { id: jobId, text, modelKey: currentKey, previousJobId: previous?.jobId, reuseSeed: reuse, settings: { ...settings }, conversationId, sourceAssetId };
      const media: MediaResult = { kind: "image", status: "pending", provider: "realistic", jobId, prompt: text, originalRequest: text, optionKey: "generate_image", label: "Realistic Vision", modelName: "", credits: 0, statusText: "מכין את התמונה…", submission, conversationId };
      const withCard: Conversation = { ...c, updatedAt: timestamp, messages: [...c.messages,
        { role: "user", content: text, privateImage: true, ...(refImage ? { images: [refImage.thumb] } : {}) },
        { role: "assistant", content: "", media, privateImage: true },
      ] };
      const next = [withCard, ...convs.filter(chat => chat.id !== id)];
      stickRef.current = true;
      setConvs(next); setActiveId(id);
      saveHistory(getStorage(), { activeId: id, conversations: next });
      setInput(""); setAttachments([]); setSourceRef(null);
      await submitRealistic(submission);
    } catch (error) {
      setToast(error instanceof Error ? error.message : MSG_GENERIC);
    } finally { imageSending.current = false; setImageSubmitting(false); }
  }

  async function generateMedia() {
    if (realisticMode) {
      if (!canGenerate) return;
      const previous = [...messages].reverse().find(m => m.media?.provider === "realistic" && m.media.status === "done")?.media;
      await generateRealistic(input, previous);
      return;
    }
    if (mode === "chat" || !canGenerate || !mediaOption || !q?.credits || !convs) return;
    if (!confirming) {
      // First tap: show the price as a confirmation.
      setConfirmFor(confirmSig);
      return;
    }
    setConfirmFor(null);
    const kind = mode;
    const credits = q.credits;
    const ref = refImage;
    const now = Date.now();
    const id = active?.id ?? newId();
    const userMsg: Msg = ref ? { role: "user", content: input.trim(), images: [ref.thumb] } : { role: "user", content: mediaPrompt };
    const media: MediaResult = {
      kind,
      status: "pending",
      prompt: mediaPrompt,
      optionKey: mediaOption.key,
      label: mediaOption.label,
      modelName: mediaOption.modelName,
      credits,
    };
    const index = messages.length + 1; // where the result card lands
    const withCard: Msg[] = [...messages, userMsg, { role: "assistant", content: "", media }];
    if (active) updateConv(id, (c) => ({ ...c, updatedAt: now, messages: withCard }));
    else {
      setConvs((cs) => cs && [{ id, title: makeTitle(mediaPrompt), createdAt: now, updatedAt: now, pinned: false, messages: withCard, modelKey: currentKey }, ...cs]);
      setActiveId(id);
    }
    setInput("");
    setAttachments([]);
    setSourceRef(null);
    stickRef.current = true;
    const patch = (p: Partial<MediaResult>) =>
      updateConv(id, (c) => ({ ...c, messages: c.messages.map((m, i) => (i === index && m.media ? { ...m, media: { ...m.media, ...p } } : m)) }));

    try {
      const res = await fetch("/api/media/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          key: mediaOption.key,
          prompt: mediaPrompt, // exactly as the user wrote it
          credits,
          image: ref ? (ref.source ? { source: ref.source } : { dataUrl: ref.dataUrl }) : null,
        }),
      });
      if (res.status === 401) return router.replace("/login");
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.id) {
        patch({ status: "failed", error: body?.error ?? MSG_GENERIC });
        if (res.status === 409) setQuoteNonce((n) => n + 1); // price changed: fetch the new one
        return refreshMedia();
      }
      patch({ jobId: body.id }); // polling picks it up from here
      setMediaCfg((c) => c && c.usage ? { ...c, usage: { ...c.usage, spent: c.usage.spent + credits, remaining: c.usage.remaining === null ? null : c.usage.remaining - credits } } : c);
      setQuoteNonce((n) => n + 1); // today's remaining credits changed
    } catch {
      patch({ status: "failed", error: MSG_NETWORK });
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
          footer={
            !realisticMode && mediaCfg?.available && mediaCfg.usage
              ? `קרדיטים היום: ${mediaCfg.usage.spent}${mediaCfg.usage.cap !== null ? ` מתוך ${mediaCfg.usage.cap}` : ""}`
              : undefined
          }
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
              <h2 className="mb-6 text-[26px] font-semibold tracking-tight">
                {mode === "image" ? "איזו תמונה ליצור?" : mode === "video" ? "איזה סרטון ליצור?" : "במה אפשר לעזור?"}
              </h2>
              <div className={`grid gap-2.5 sm:grid-cols-2 ${mediaMode || pendingDoc ? "hidden" : ""}`}>
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
                    {m.doc && (
                      <div className="max-w-[85%]">
                        <DocChip name={m.doc.name} size={m.doc.size} doc={m.doc} />
                      </div>
                    )}
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
                    {m.media?.provider === "realistic" ? (
                      <RealisticImageCard
                        m={m.media} onView={setViewer}
                        onEdit={url => takeAsReference(url, "image", "realistic")}
                        submitting={imageSubmitting}
                        onRetry={() => m.media?.submission && void retryRealistic(m.media.submission)}
                        onVariant={reuse => {
                          setMode("image"); chooseImageProvider("realistic");
                          const directSettings = m.media?.settings && ["direct", "translate"].includes(m.media.settings.promptMode ?? "") ? { ...m.media.settings, seed: reuse ? m.media.settings.seed : -1 } : undefined;
                          void generateRealistic(directSettings?.prompt ?? (reuse ? "צור גרסה עם אותו Seed" : "צור גרסה נוספת"), m.media, reuse, directSettings);
                        }}
                      />
                    ) : m.media ? (
                      <MediaCard
                        m={m.media}
                        onView={setViewer}
                        onToVideo={(url) => takeAsReference(url, "video")}
                        onEdit={(url) => takeAsReference(url, "image")}
                        onStop={() => (m.media?.jobId ? polling.stop(m.media.jobId) : setMediaStatusAt(i, "stopped"))}
                        onResume={() => (m.media?.jobId ? polling.resume(m.media.jobId) : setMediaStatusAt(i, "pending"))}
                      />
                    ) : m.content ? (
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
                        {answeredBy(m.modelKey) && (
                          <span className="text-[13px] text-muted" title="המודל שענה">
                            {answeredBy(m.modelKey)!.label} · <span dir="ltr" className="whitespace-nowrap">{answeredBy(m.modelKey)!.modelName}</span>
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

        {/* z-20: above the header, so the model sheet's overlay covers it; below the history drawer. */}
        <div className="sticky bottom-0 z-20 bg-bg pb-[max(env(safe-area-inset-bottom),0.75rem)] before:pointer-events-none before:absolute before:inset-x-0 before:-top-6 before:h-6 before:bg-linear-to-t before:from-bg">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (mediaMode) void generateMedia();
              else send(input);
            }}
            className="mx-auto max-w-3xl px-3 sm:px-5"
          >
            <div className="rounded-[1.75rem] border border-line bg-surface p-2 shadow-[0_1px_8px_rgb(0_0_0/0.04)] transition-[border-color] focus-within:border-muted/50">
              {pendingDoc && (
                <div className="space-y-2 px-1.5 pt-1.5 pb-2.5">
                  <div className="flex">
                    <DocChip name={pendingDoc.name} size={pendingDoc.size} doc={pendingDoc.parsed} onRemove={() => setDoc(null)} />
                  </div>
                  {!docNoteSeen && (
                    <p data-testid="doc-privacy" className="flex items-start gap-1.5 px-1 text-[13px] leading-snug text-muted">
                      <span className="flex-1">{DOC_PRIVACY_NOTE}</span>
                      <button
                        type="button"
                        onClick={dismissDocNote}
                        aria-label="סגירת ההערה"
                        className="press -m-1 shrink-0 rounded-full p-1 transition-[background-color,transform] hover:bg-bubble"
                      >
                        <X size={14} aria-hidden />
                      </button>
                    </p>
                  )}
                  <div role="group" aria-label="הצעות לשאלות על המסמך" className="flex flex-wrap gap-1.5">
                    {DOC_SUGGESTIONS.map((sug) => (
                      <button
                        key={sug}
                        type="button"
                        disabled={docParsing || streaming}
                        onClick={() => send(sug)}
                        className="press rounded-full border border-line px-3 py-1.5 text-[14px] leading-none transition-[background-color,opacity,transform] hover:bg-bubble disabled:opacity-40"
                      >
                        {sug}
                      </button>
                    ))}
                  </div>
                </div>
              )}
              {(shown.length > 0 || (mediaMode && sourceRef)) && (
                <div className="flex gap-2.5 px-1.5 pt-1.5 pb-2.5">
                  {mediaMode && sourceRef ? (
                    <div className="fade-in relative size-16 shrink-0">
                      <Img src={sourceRef} alt="תמונה מצורפת 1" className="size-16 rounded-xl object-cover" />
                      <button
                        type="button"
                        onClick={() => setSourceRef(null)}
                        aria-label="הסרת תמונה 1"
                        title="הסרה"
                        className="press absolute -inset-s-1.5 -top-1.5 flex size-6 items-center justify-center rounded-full bg-fg text-bg shadow transition-transform"
                      >
                        <X size={14} strokeWidth={2.5} aria-hidden />
                      </button>
                    </div>
                  ) : (
                    shown.map((a, i) => (
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
                    ))
                  )}
                </div>
              )}
              {realisticMode && <ImageAdvanced value={imageSettings} onChange={setImageSettings} promptAI={!!imageCfg?.promptAI} />}
              {mediaMode && mediaInfo && (
                // Live price and today's remaining credits; the price shown is the one confirmed.
                <p role="status" data-testid="media-info" className={`px-2 pb-1 text-[13px] ${mediaInfoWarn ? "text-danger" : "text-muted"}`}>
                  {mediaInfo}
                </p>
              )}
              {/* RTL order: attach · mode · textarea · model chip · send. On narrow screens with the
                  chip or modes, the textarea takes its own row and the buttons sit in a row below it. */}
              <div className="flex flex-wrap items-end gap-1.5">
              {/* Two buttons, two inputs: a picker that mixes image/* with documents opens the
                  photo picker on Android, so documents get their own input with no image types. */}
              {showImages && (
                <button
                  type="button"
                  onClick={() => {
                    void loadProcessor().catch(() => {}); // start downloading while the picker is open
                    fileRef.current?.click();
                  }}
                  disabled={mediaMode ? !!refImage || shown.length > 0 : attachments.length >= MAX_IMAGES}
                  aria-label="צירוף תמונה"
                  title="צירוף תמונה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-[background-color,color,opacity,transform] hover:bg-bubble hover:text-fg disabled:opacity-35"
                >
                  <ImagePlus size={21} aria-hidden />
                </button>
              )}
              {!mediaMode && (
                <button
                  type="button"
                  onClick={() => docRef.current?.click()}
                  aria-label="צירוף מסמך"
                  title="צירוף מסמך (PDF, Word, טקסט, CSV)"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full text-muted transition-[background-color,color,opacity,transform] hover:bg-bubble hover:text-fg disabled:opacity-35"
                >
                  <Paperclip size={20} aria-hidden />
                </button>
              )}
              {(mediaCfg?.configured || imageCfg !== null) && (
                <div className="flex h-10 items-center">
                  <ModeSwitch value={mode} onChange={switchMode} />
                </div>
              )}
              <input
                ref={fileRef}
                type="file"
                data-testid="image-input"
                accept="image/*"
                multiple={!mediaMode}
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = ""; // picking the same file again should still fire
                  if (mediaMode) void addImages(files);
                  else addFiles(files);
                }}
              />
              <input
                ref={docRef}
                type="file"
                data-testid="doc-input"
                accept={DOC_ACCEPT}
                hidden
                onChange={(e) => {
                  const files = [...(e.target.files ?? [])];
                  e.target.value = "";
                  addFiles(files);
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
                    if (mediaMode) void generateMedia();
                    else send(input);
                  }
                }}
                placeholder={
                  mediaMode && refImage
                    ? mode === "image"
                      ? "מה לשנות בתמונה?"
                      : "איך להניע את התמונה? (לא חובה)"
                    : pendingDoc
                      ? "שאלו משהו על המסמך…"
                      : PLACEHOLDERS[mode]
                }
                aria-label="הודעה"
                className={`max-h-40 min-w-0 resize-none bg-transparent py-2 leading-6 outline-none placeholder:text-muted ${
                  twoRow
                    ? `order-first w-full px-2 sm:order-0 sm:w-auto sm:flex-1 sm:pe-0 ${canAttach || mediaCfg?.configured ? "sm:ps-0.5" : ""}`
                    : `flex-1 ${canAttach ? "ps-0.5" : "ps-2"}`
                }`}
              />
              <div className="ms-auto flex shrink-0 items-center gap-1.5">
              {!mediaMode && showPicker && (
                <ModelPicker
                  models={models}
                  value={currentKey}
                  onChange={chooseModel}
                  exhausted={exhausted}
                  now={now}
                  attention={attention}
                />
              )}
              {mode === "image" && (
                <ModelPicker models={IMAGE_PROVIDERS} value={imageProvider} onChange={chooseImageProvider} exhausted={NO_EXHAUSTED} now={now} attention={0} />
              )}
              {openArtMode && mediaOptions.length > 0 && (
                <ModelPicker
                  models={mediaOptions.map(asPickerModel)}
                  value={mediaKey}
                  onChange={(k) => setMediaKeys((m) => ({ ...m, [mode]: k }))}
                  exhausted={NO_EXHAUSTED}
                  now={now}
                  attention={0}
                />
              )}
              {streaming && !mediaMode ? (
                <button
                  type="button"
                  onClick={stopStreaming}
                  aria-label="עצירה"
                  title="עצירה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-fg text-bg transition-transform"
                >
                  <Square size={14} fill="currentColor" aria-hidden />
                </button>
              ) : realisticMode ? (
                <button type="submit" disabled={!canGenerate || !convs} aria-label="יצירת תמונה" title="יצירת תמונה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-[opacity,transform] disabled:opacity-30">
                  <ArrowUp size={20} strokeWidth={2.25} aria-hidden />
                </button>
              ) : mediaMode ? (
                <button
                  type="submit"
                  disabled={!canGenerate || !convs}
                  aria-label={confirming ? `אישור: יצירה ב-${q?.credits} קרדיטים` : `יצירה · ${q?.credits ?? "…"} קרדיטים`}
                  title={confirming ? "הקישו לאישור" : "יצירה"}
                  data-confirming={confirming || undefined}
                  className={`press flex h-10 shrink-0 items-center gap-1 rounded-full ps-2.5 pe-3 text-[15px] font-semibold transition-[background-color,color,opacity,transform] disabled:opacity-30 ${
                    confirming ? "bg-fg text-bg" : "bg-accent text-accent-fg"
                  }`}
                >
                  {confirming ? <Check size={18} strokeWidth={2.5} aria-hidden /> : <ArrowUp size={18} strokeWidth={2.25} aria-hidden />}
                  <span dir="ltr">{q?.credits ?? "…"}</span>
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={(!input.trim() && !pending.length && !pendingDoc?.parsed) || !convs || processing > 0 || docParsing}
                  aria-label="שליחה"
                  title="שליחה"
                  className="press flex size-10 shrink-0 items-center justify-center rounded-full bg-accent text-accent-fg transition-[opacity,transform] disabled:opacity-30"
                >
                  <ArrowUp size={20} strokeWidth={2.25} aria-hidden />
                </button>
              )}
              </div>
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
