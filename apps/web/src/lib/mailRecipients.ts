export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const MAX_RECIPIENTS_PER_FIELD = 50;

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(String(email || "").trim());
}

export function parseRecipients(raw: string): string[] {
  const parts = String(raw || "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  const out: string[] = [];
  for (const p of parts) if (!out.includes(p)) out.push(p);
  return out;
}

export interface ValidatedRecipients { ok: boolean; error?: string; to: string[]; cc: string[]; bcc: string[]; }

export function validateRecipients(input: { to?: string[]; cc?: string[]; bcc?: string[] }): ValidatedRecipients {
  const norm = (arr?: string[]) => Array.from(new Set((arr || []).map((s) => String(s).trim().toLowerCase()).filter(Boolean)));
  const to = norm(input.to), cc = norm(input.cc), bcc = norm(input.bcc);
  if (to.length === 0) return { ok: false, error: "Укажите хотя бы одного получателя", to, cc, bcc };
  const fields: Array<[string, string[]]> = [["Кому", to], ["CC", cc], ["BCC", bcc]];
  for (const [name, arr] of fields) {
    if (arr.length > MAX_RECIPIENTS_PER_FIELD) return { ok: false, error: `Слишком много адресов в поле ${name}`, to, cc, bcc };
    for (const e of arr) if (!isValidEmail(e)) return { ok: false, error: `Некорректный адрес: ${e}`, to, cc, bcc };
  }
  return { ok: true, to, cc, bcc };
}
