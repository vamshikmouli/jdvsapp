// In-browser search for lists loaded once (Students, Fees) — instant, no request
// per keystroke, and it covers every loaded row, not just the visible page.
// Text fields match case-insensitively; a query with digits also matches phone
// numbers ignoring spaces / +91 formatting.
export function matchesQuery(q: string, text: (string | null | undefined)[], phones: (string | null | undefined)[] = []): boolean {
  const term = q.trim().toLowerCase();
  if (!term) return true;
  if (text.some((t) => t && t.toLowerCase().includes(term))) return true;
  const digits = term.replace(/\D/g, '');
  return digits.length >= 3 && phones.some((p) => p && p.replace(/\D/g, '').includes(digits));
}
