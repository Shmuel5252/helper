// Conversation history in localStorage: pure functions, so they're unit-testable with a fake Storage.
//
// Layout: one versioned key, STORE_KEY = { v: 2, activeId, conversations: Conversation[] }.
// The pre-history app kept a single Msg[] under LEGACY_KEY; loadHistory() migrates it.

import { storedDoc, type DocAttachment } from "./documents.ts";

export type Msg = {
  archiveTurnId?: string;
  role: "user" | "assistant";
  content: string;
  error?: string;
  modelKey?: string; // assistant: which model option answered
  images?: string[]; // user: ~200px JPEG thumbnails (data URLs), persisted
  full?: string[]; // user: the resized images actually sent; memory only, never persisted
  media?: MediaResult; // assistant: an OpenArt image/video generation instead of text
  doc?: DocAttachment; // user: an attached document's text (persisted capped at DOC_STORE_CHARS)
};

// A generated image/video. Stores our proxied URL (/media/...) and metadata, never the file.
export type MediaResult = {
  provider?: 'account'|'fal';
  conversationId?: string;
  kind: "image" | "video";
  status: "pending" | "done" | "failed" | "stopped";
  jobId?: string;
  prompt: string; // what the user wrote (usually Hebrew)
  optionKey: string;
  label: string;
  modelName: string;
  credits: number;
  url?: string;
  poster?: string;
  error?: string;
};

// How a generation appears in the history sent to the chat model.
export const mediaAsText = (m: MediaResult) => `[${m.kind === "video" ? "סרטון שנוצר" : "תמונה שנוצרה"}: ${m.prompt}]`;

export type Conversation = {
  archiveId?: string;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  pinned: boolean;
  messages: Msg[];
  modelKey?: string; // model option for this conversation's next message
};

export type History = { activeId: string | null; conversations: Conversation[] };

type Store = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const STORE_KEY = "ai-chat:v2";
export const LEGACY_KEY = "ai-chat:v1";
export const MAX_CONVERSATIONS = 100;
const TITLE_MAX = 40;

export function newId(): string {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

export function makeTitle(text: string): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t) return "שיחה חדשה";
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX).trimEnd() + "…" : t;
}

function isConversation(c: unknown): c is Conversation {
  const x = c as Conversation;
  return !!x && typeof x.id === "string" && typeof x.title === "string" && Array.isArray(x.messages);
}

export function loadHistory(storage: Store | null, now = Date.now()): History {
  const empty: History = { activeId: null, conversations: [] };
  if (!storage) return empty;

  let history = empty;
  try {
    const raw = storage.getItem(STORE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const conversations = Array.isArray(parsed?.conversations)
        ? parsed.conversations.filter(isConversation).map((c:Conversation)=>({...c,messages:c.messages.map(m=>
          m.media?.provider&&m.media.status==='pending'&&!m.media.conversationId
            ? {...m,media:{...m.media,status:'failed',error:'השליחה לא הושלמה. אפשר לנסות שוב.'}}
            : m)}))
        : [];
      const activeId = conversations.some((c: Conversation) => c.id === parsed.activeId)
        ? parsed.activeId
        : null;
      history = { activeId, conversations };
    }
  } catch {
    // corrupt store: start fresh rather than crash
  }

  try {
    const legacyRaw = storage.getItem(LEGACY_KEY);
    if (legacyRaw === null) return history;
    const legacy = JSON.parse(legacyRaw);
    const messages: Msg[] = Array.isArray(legacy) ? legacy : [];
    const firstUser = messages.find((m) => m?.role === "user");
    if (firstUser) {
      const c: Conversation = {
        id: newId(),
        title: makeTitle(firstUser.content),
        createdAt: now,
        updatedAt: now,
        pinned: false,
        messages,
      };
      history = { activeId: c.id, conversations: [c, ...history.conversations] };
    }
    // Only drop the old key once the new one is safely written.
    if (!saveHistory(storage, history).ok) return history;
    storage.removeItem(LEGACY_KEY);
  } catch {
    // unreadable legacy data: leave it alone
  }
  return history;
}

function isQuotaError(e: unknown): boolean {
  return (
    e instanceof DOMException &&
    (e.name === "QuotaExceededError" || e.name === "NS_ERROR_DOM_QUOTA_REACHED" || e.code === 22)
  );
}

// Removes the oldest unpinned conversation (never `keepId`). Returns null when nothing can go.
function dropOldest(list: Conversation[], keepId: string | null): Conversation[] | null {
  let victim: Conversation | null = null;
  for (const c of list)
    if (!c.pinned && c.id !== keepId && (!victim || c.updatedAt < victim.updatedAt)) victim = c;
  return victim ? list.filter((c) => c !== victim) : null;
}

// Enforces the 100-conversation cap, then writes; on quota errors keeps dropping the
// oldest unpinned conversation until it fits. `quotaPruned` counts removals caused by quota.
export function saveHistory(
  storage: Store | null,
  history: History,
  options: { prune?: boolean } = {},
): { ok: boolean; quotaPruned: number; history: History } {
  let list = history.conversations;
  while (options.prune !== false && list.length > MAX_CONVERSATIONS) {
    const next = dropOldest(list, history.activeId);
    if (!next) break;
    list = next;
  }
  const capped = list.length;

  for (;;) {
    const current = { activeId: history.activeId, conversations: list };
    const quotaPruned = capped - list.length;
    if (!storage) return { ok: false, quotaPruned, history: current };
    try {
      // Full-size images stay in memory only; storage keeps the small thumbnails.
      storage.setItem(STORE_KEY, JSON.stringify({ v: 2, ...current }, (k, v) => (k === "full" ? undefined : k === "doc" ? storedDoc(v) : v)));
      return { ok: true, quotaPruned, history: current };
    } catch (e) {
      const next = options.prune !== false && isQuotaError(e) ? dropOldest(list, history.activeId) : null;
      if (!next) return { ok: false, quotaPruned, history: current };
      list = next;
    }
  }
}

export type Group = { label: string; items: Conversation[] };

// Pinned first, then by last activity: today, yesterday, last 7 days, older. Empty groups omitted.
export function groupConversations(conversations: Conversation[], now = Date.now()): Group[] {
  const day = (offset: number) => {
    const d = new Date(now);
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - offset);
    return d.getTime();
  };
  const today = day(0);
  const yesterday = day(1);
  const week = day(7);

  const groups: Group[] = [
    { label: "נעוצות", items: [] },
    { label: "היום", items: [] },
    { label: "אתמול", items: [] },
    { label: "7 הימים האחרונים", items: [] },
    { label: "ישן יותר", items: [] },
  ];
  const sorted = [...conversations].sort((a, b) => b.updatedAt - a.updatedAt);
  for (const c of sorted) {
    const i = c.pinned
      ? 0
      : c.updatedAt >= today
        ? 1
        : c.updatedAt >= yesterday
          ? 2
          : c.updatedAt >= week
            ? 3
            : 4;
    groups[i].items.push(c);
  }
  return groups.filter((g) => g.items.length);
}
