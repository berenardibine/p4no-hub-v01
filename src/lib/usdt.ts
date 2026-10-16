// Display-side USDT helpers. Integer cents only (no float math). The database
// (usdt_withdrawal_create) is the authority; this just mirrors its rules.
export const MIN_WITHDRAW_USDT = 1;

export function toCents(v: string | number | null | undefined): number | null {
  const s = String(v ?? "").trim();
  const m = /^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 100 + Number((m[2] || "").padEnd(2, "0"));
}

export function validateWithdrawal(amount: string, available: string | number, payId: string): string | null {
  const c = toCents(amount);
  if (c === null) return "Enter an amount with at most 2 decimals";
  if (c < MIN_WITHDRAW_USDT * 100) return `Minimum withdrawal is ${MIN_WITHDRAW_USDT} USDT`;
  const avail = toCents(Number(available || 0).toFixed(2)) ?? 0;
  if (c > avail) return "Amount is above your available balance";
  if (!/^\d{6,12}$/.test(payId.trim())) return "Enter a valid Binance Pay ID (6-12 digits)";
  return null;
}
