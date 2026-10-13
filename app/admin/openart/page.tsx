import { Suspense } from "react";
import type { Metadata } from "next";
import { cookies } from "next/headers";
import { notFound } from "next/navigation";
import { ADMIN_COOKIE, isAdmin } from "@/lib/auth";
import { accountSummary } from "@/lib/openart/account";
import { configured, status } from "@/lib/openart/connection";
import { callTool } from "@/lib/openart/mcp";
import { usage } from "@/lib/openart/usage";

export const metadata: Metadata = { title: "ניהול · OpenArt" };

const MESSAGES: Record<string, string> = {
  connected: "החשבון חובר בהצלחה.",
  disconnected: "החיבור נותק והאסימונים בוטלו.",
  code: "קוד הניהול שגוי.",
  config: "חסרות הגדרות בשרת (Upstash או OPENART_TOKEN_KEY).",
  connect: "לא הצלחנו להתחיל את החיבור ל-OpenArt.",
  callback: "החיבור נכשל בשלב החזרה מ-OpenArt. נסו שוב.",
  denied: "החיבור בוטל או נדחה ב-OpenArt.",
};

const fmt = (ms: number) =>
  new Intl.DateTimeFormat("he-IL", { dateStyle: "short", timeStyle: "short", timeZone: "Asia/Jerusalem" }).format(ms);

const button =
  "press h-11 rounded-2xl px-5 text-base font-medium transition-[opacity,transform] disabled:opacity-40";

async function Panel({ searchParams }: { searchParams: PageProps<"/admin/openart">["searchParams"] }) {
  const jar = await cookies();
  if (!process.env.ADMIN_CODE) notFound(); // checked at request time, not baked in at build
  const params = await searchParams;
  const note = MESSAGES[String(params.ok ?? params.e ?? "")];
  const isError = !!params.e;

  if (!(await isAdmin(jar.get(ADMIN_COOKIE)?.value))) {
    return (
      <form action="/api/admin/login" method="post" className="space-y-4">
        <p className="text-muted">הדף הזה לבעלים בלבד.</p>
        <label htmlFor="code" className="sr-only">
          קוד ניהול
        </label>
        <input
          id="code"
          name="code"
          type="password"
          required
          autoComplete="current-password"
          placeholder="קוד ניהול"
          className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none focus:border-accent"
        />
        {note && (
          <p role="alert" className="text-danger">
            {note}
          </p>
        )}
        <button type="submit" className={`${button} w-full bg-accent text-accent-fg`}>
          כניסה
        </button>
      </form>
    );
  }

  const ready = configured();
  let st = ready ? await status().catch(() => null) : null;
  const account = st?.connected
    ? await callTool("openart_account_get").catch((e: Error) => {
        console.error("OpenArt account_get failed:", e.message);
        return null;
      })
    : null;
  // That call may have just found the chain broken (refresh rejected): show the current state.
  if (st?.connected && !account) st = await status().catch(() => null);
  const today = ready ? await usage().catch(() => null) : null;
  const { credits: balance, plan } = accountSummary(account);

  return (
    <div className="space-y-6">
      {note && (
        <p role={isError ? "alert" : "status"} className={isError ? "text-danger" : "text-accent"}>
          {note}
        </p>
      )}

      <dl className="space-y-3 rounded-2xl border border-line bg-surface p-4 text-base" data-testid="openart-status">
        <div className="flex justify-between gap-4">
          <dt className="text-muted">מצב</dt>
          <dd className="font-medium">
            {!ready ? "לא מוגדר" : st?.connected ? "מחובר" : st?.broken ? "החיבור נשבר" : "לא מחובר"}
          </dd>
        </div>
        {st?.broken && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">מתי נשבר</dt>
            <dd>{fmt(st.broken.at)}</dd>
          </div>
        )}
        {st?.tokens && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">רענון אחרון</dt>
            <dd>{fmt(st.tokens.refreshed_at)}</dd>
          </div>
        )}
        {st?.connected && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">יתרת קרדיטים</dt>
            <dd className="font-medium" data-testid="balance">
              {balance !== undefined ? balance.toLocaleString("he-IL") : "לא זמין"}
            </dd>
          </div>
        )}
        {plan !== undefined && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">מסלול</dt>
            <dd>{plan}</dd>
          </div>
        )}
        {today && (
          <div className="flex justify-between gap-4">
            <dt className="text-muted">שימוש היום</dt>
            <dd>
              {today.cap === null ? `${today.spent} קרדיטים (ללא תקרה יומית)` : `${today.spent} מתוך ${today.cap} קרדיטים`}
            </dd>
          </div>
        )}
      </dl>

      <div className="flex flex-wrap gap-3">
        <form action="/api/admin/openart/connect" method="post">
          <button type="submit" disabled={!ready} className={`${button} bg-accent text-accent-fg`}>
            {st?.connected ? "חיבור מחדש" : "חיבור ל-OpenArt"}
          </button>
        </form>
        {st?.connected && (
          <form action="/api/admin/openart/disconnect" method="post">
            <button type="submit" className={`${button} border border-line bg-surface text-danger`}>
              ניתוק
            </button>
          </form>
        )}
      </div>
      <p className="text-[14px] text-muted">
        החיבור משתמש בחשבון OpenArt שלך. אחרי &quot;חיבור&quot; תועברו ל-OpenArt לאישור, ותחזרו לכאן.
      </p>
    </div>
  );
}

export default function AdminOpenArtPage({ searchParams }: PageProps<"/admin/openart">) {
  return (
    <main className="mx-auto min-h-dvh max-w-md px-6 py-12">
      <h1 className="mb-6 text-2xl font-semibold tracking-tight">חיבור ל-OpenArt</h1>
      <Suspense fallback={<p className="text-muted">טוען…</p>}>
        <Panel searchParams={searchParams} />
      </Suspense>
    </main>
  );
}
