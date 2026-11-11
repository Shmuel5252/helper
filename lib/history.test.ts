import { test } from "node:test";
import assert from "node:assert/strict";
import {
  LEGACY_KEY,
  MAX_CONVERSATIONS,
  STORE_KEY,
  groupConversations,
  loadHistory,
  makeTitle,
  saveHistory,
  type Conversation,
} from "./history.ts";
import { DOC_STORE_CHARS } from "./documents.ts";

class FakeStorage {
  data = new Map<string, string>();
  limit = Infinity; // max chars per value, to simulate quota
  getItem(k: string) {
    return this.data.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    if (v.length > this.limit) throw new DOMException("full", "QuotaExceededError");
    this.data.set(k, v);
  }
  removeItem(k: string) {
    this.data.delete(k);
  }
}

const conv = (id: string, updatedAt: number, extra: Partial<Conversation> = {}): Conversation => ({
  id,
  title: id,
  createdAt: updatedAt,
  updatedAt,
  pinned: false,
  messages: [{ role: "user", content: "x".repeat(100) }],
  ...extra,
});
test('non-pruning save preserves old history when storage fills and retains more than 100 conversations',()=>{
  const s=new FakeStorage();
  const first={activeId:'old',conversations:[conv('old',1)]};
  saveHistory(s,first,{prune:false});
  const snapshot=s.getItem(STORE_KEY);
  s.limit=snapshot!.length;
  const next={activeId:'new',conversations:[conv('new',2),...first.conversations]};
  const result=saveHistory(s,next,{prune:false});
  assert.equal(result.ok,false);
  assert.equal(result.quotaPruned,0);
  assert.equal(s.getItem(STORE_KEY),snapshot);
  s.limit=Infinity;
  const many={activeId:'0',conversations:Array.from({length:101},(_,i)=>conv(String(i),i))};
  assert.equal(saveHistory(s,many,{prune:false}).history.conversations.length,101);
});

test("title: trimmed, whitespace collapsed, cut at 40 chars with an ellipsis", () => {
  assert.equal(makeTitle("  שלום   עולם \n "), "שלום עולם");
  assert.equal(makeTitle("א".repeat(40)), "א".repeat(40));
  assert.equal(makeTitle("א".repeat(41)), "א".repeat(40) + "…");
  assert.equal(makeTitle("abc ".repeat(20)), "abc ".repeat(10).trimEnd() + "…"); // no space before the ellipsis
  assert.equal(makeTitle("   "), "שיחה חדשה");
});

test("migration: old single conversation becomes the active one, old key removed", () => {
  const s = new FakeStorage();
  const old = [
    { role: "user", content: "מה מזג האוויר היום בתל אביב והאם כדאי לקחת מטריה?" },
    { role: "assistant", content: "קשה לי לדעת" },
  ];
  s.setItem(LEGACY_KEY, JSON.stringify(old));
  const h = loadHistory(s, 1000);
  assert.equal(h.conversations.length, 1);
  assert.equal(h.activeId, h.conversations[0].id);
  assert.deepEqual(h.conversations[0].messages, old);
  assert.equal(h.conversations[0].title, "מה מזג האוויר היום בתל אביב והאם כדאי לק…");
  assert.equal(s.getItem(LEGACY_KEY), null);
  assert.deepEqual(loadHistory(s), h); // second load reads the new key, no duplicate
});

test("migration: empty old chat just removes the old key; failed write keeps it", () => {
  const s = new FakeStorage();
  s.setItem(LEGACY_KEY, "[]");
  assert.deepEqual(loadHistory(s).conversations, []);
  assert.equal(s.getItem(LEGACY_KEY), null);

  const full = new FakeStorage();
  full.setItem(LEGACY_KEY, JSON.stringify([{ role: "user", content: "hi" }]));
  full.limit = 10;
  assert.equal(loadHistory(full).conversations.length, 1); // still shown this session
  assert.notEqual(full.getItem(LEGACY_KEY), null); // retried next load
});

test("migration: old chat is added even if a new-format store already exists", () => {
  const s = new FakeStorage();
  s.setItem(STORE_KEY, JSON.stringify({ v: 2, activeId: null, conversations: [conv("existing", 5)] }));
  s.setItem(LEGACY_KEY, JSON.stringify([{ role: "user", content: "ישנה" }]));
  const h = loadHistory(s, 10);
  assert.deepEqual(h.conversations.map((c) => c.title), ["ישנה", "existing"]);
  assert.equal(s.getItem(LEGACY_KEY), null);
});

test("load: corrupt or missing storage never throws", () => {
  const s = new FakeStorage();
  s.data.set(STORE_KEY, "{not json");
  assert.deepEqual(loadHistory(s), { activeId: null, conversations: [] });
  assert.deepEqual(loadHistory(null), { activeId: null, conversations: [] });
});

test("grouping: pinned first, then today / yesterday / 7 days / older, empty groups hidden", () => {
  const now = new Date(2026, 9, 11, 15, 0).getTime();
  const at = (d: number, h = 12) => new Date(2026, 9, 11 - d, h).getTime();
  const groups = groupConversations(
    [
      conv("old", at(30)),
      conv("today-early", at(0, 1)),
      conv("pinned-old", at(40), { pinned: true }),
      conv("yesterday", at(1, 23)),
      conv("week", at(6)),
      conv("today-late", at(0, 14)),
    ],
    now,
  );
  assert.deepEqual(
    groups.map((g) => [g.label, g.items.map((c) => c.id)]),
    [
      ["נעוצות", ["pinned-old"]],
      ["היום", ["today-late", "today-early"]],
      ["אתמול", ["yesterday"]],
      ["7 הימים האחרונים", ["week"]],
      ["ישן יותר", ["old"]],
    ],
  );
  assert.deepEqual(
    groupConversations([conv("a", at(0))], now).map((g) => g.label),
    ["היום"],
  );
});

test("pruning on quota: drops oldest unpinned (never pinned or active) until it fits", () => {
  const s = new FakeStorage();
  const list = [
    conv("pinned-oldest", 1, { pinned: true }),
    conv("active-old", 2),
    conv("a", 3),
    conv("b", 4),
    conv("c", 5),
  ];
  const oneSize = JSON.stringify(list[0]).length;
  s.limit = oneSize * 3.5; // room for about 3
  const r = saveHistory(s, { activeId: "active-old", conversations: list });
  assert.equal(r.ok, true);
  assert.equal(r.quotaPruned, 2);
  assert.deepEqual(r.history.conversations.map((c) => c.id), ["pinned-oldest", "active-old", "c"]);
  assert.ok(s.getItem(STORE_KEY));
});

test("pruning on quota: gives up cleanly when only protected conversations remain", () => {
  const s = new FakeStorage();
  s.limit = 10;
  const r = saveHistory(s, { activeId: "x", conversations: [conv("x", 1), conv("p", 2, { pinned: true })] });
  assert.equal(r.ok, false);
  assert.equal(r.history.conversations.length, 2);
});

test("non-quota storage errors don't delete anything", () => {
  const s = new FakeStorage();
  s.setItem = () => {
    throw new DOMException("denied", "SecurityError");
  };
  const r = saveHistory(s, { activeId: null, conversations: [conv("a", 1), conv("b", 2)] });
  assert.equal(r.ok, false);
  assert.equal(r.quotaPruned, 0);
});

test("soft cap: keeps at most 100, pruning the oldest unpinned", () => {
  const list = Array.from({ length: 105 }, (_, i) => conv(`c${i}`, i, { pinned: i === 0 }));
  const r = saveHistory(new FakeStorage(), { activeId: null, conversations: list });
  assert.equal(r.history.conversations.length, MAX_CONVERSATIONS);
  assert.equal(r.quotaPruned, 0); // cap pruning is silent, no quota toast
  const ids = r.history.conversations.map((c) => c.id);
  assert.ok(ids.includes("c0")); // pinned survives
  assert.ok(!ids.includes("c1") && !ids.includes("c5") && ids.includes("c6"));
});

test("documents: kept in history for follow-ups, text capped in storage, full size still known", () => {
  const s = new FakeStorage();
  const text = "מ".repeat(DOC_STORE_CHARS + 1000);
  const doc = { name: "דוח.pdf", type: "pdf" as const, size: 12345, text, chars: text.length, pages: 3 };
  const c = conv("d", 1, { messages: [{ role: "user", content: "סכם את המסמך", doc }] });
  const r = saveHistory(s, { activeId: "d", conversations: [c] });
  assert.equal(r.ok, true);
  assert.equal(r.history.conversations[0].messages[0].doc?.text.length, text.length, "memory keeps the full text");
  const back = loadHistory(s).conversations[0].messages[0].doc!;
  assert.equal(back.text.length, DOC_STORE_CHARS);
  assert.deepEqual([back.name, back.type, back.size, back.chars, back.pages], ["דוח.pdf", "pdf", 12345, text.length, 3]);
});
