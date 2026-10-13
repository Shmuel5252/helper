// openart_account_get replies { user: { uid, email }, plan, credits } (checked against the real
// server). Anything else → undefined, shown as "not available".
export function accountSummary(account: unknown): { credits?: number; plan?: string } {
  const a = (account && typeof account === "object" ? account : {}) as Record<string, unknown>;
  return {
    credits: typeof a.credits === "number" && Number.isFinite(a.credits) ? a.credits : undefined,
    plan: typeof a.plan === "string" && a.plan ? a.plan : undefined,
  };
}
