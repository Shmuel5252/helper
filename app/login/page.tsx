import { Suspense } from "react";
import type { Metadata } from "next";

export const metadata: Metadata = { title: "כניסה · צ׳אט AI" };

async function WrongCode({ searchParams }: Pick<PageProps<"/login">, "searchParams">) {
  const { e } = await searchParams;
  if (!e) return null;
  return (
    <p role="alert" className="text-sm text-danger">
      הקוד שגוי. נסו שוב.
    </p>
  );
}

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="flex min-h-dvh items-center justify-center px-6 pb-[env(safe-area-inset-bottom)]">
      <form action="/api/login" method="post" className="w-full max-w-xs space-y-6">
        <div className="space-y-2 text-center">
          <h1 className="text-2xl font-semibold tracking-tight">צ׳אט AI</h1>
          <p className="text-muted">הזינו את קוד הגישה כדי להתחיל</p>
        </div>
        <div className="space-y-2">
          <label htmlFor="code" className="sr-only">
            קוד גישה
          </label>
          <input
            id="code"
            name="code"
            type="password"
            required
            autoFocus
            autoComplete="current-password"
            autoCapitalize="none"
            autoCorrect="off"
            enterKeyHint="go"
            placeholder="קוד גישה"
            className="h-12 w-full rounded-2xl border border-line bg-surface px-4 text-base outline-none transition-[border-color,box-shadow] focus:border-accent focus:ring-4 focus:ring-accent/15"
          />
          <Suspense>
            <WrongCode searchParams={searchParams} />
          </Suspense>
        </div>
        <button
          type="submit"
          className="press h-12 w-full rounded-2xl bg-accent text-base font-medium text-accent-fg transition-[opacity,transform]"
        >
          כניסה
        </button>
      </form>
    </main>
  );
}
