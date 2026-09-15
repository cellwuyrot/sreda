/** PROJECT-MAIL: разбор и валидация получателей (Кому/CC/BCC). Чистые функции. */
export const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
export const MAX_RECIPIENTS_PER_FIELD = 50;

export function isValidEmail(value: string): boolean {
  return EMAIL_RE.test((value || "").trim());
}

export function parseRecipients(raw: string | string[] | undefined | null): string[] {
  if (!raw) return [];
  const parts = Array.isArray(raw) ? raw : String(raw).split(/[,;\n]+/);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const p of parts) {
    const v = (p || "").trim();
    if (!v) continue;
    const key = v.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(v);
  }
  return out;
}

export interface RecipientsInput {
  to: string | string[];
  cc?: string | string[];
  bcc?: string | string[];
}

export type RecipientsResult =
  | { ok: true; to: string[]; cc: string[]; bcc: string[] }
  | { ok: false; error: string };

export function validateRecipients(input: RecipientsInput): RecipientsResult {
  const to = parseRecipients(input.to);
  const cc = parseRecipients(input.cc);
  const bcc = parseRecipients(input.bcc);
  if (to.length === 0) return { ok: false, error: "Укажите хотя бы одного получателя" };
  const fields: Array<[string, string[]]> = [["Кому", to], ["CC", cc], ["BCC", bcc]];
  for (const [name, list] of fields) {
    if (list.length > MAX_RECIPIENTS_PER_FIELD) {
      return { ok: false, error: `Слишком много адресов в поле «${name}» (макс. ${MAX_RECIPIENTS_PER_FIELD})` };
    }
    for (const addr of list) {
      if (!isValidEmail(addr)) return { ok: false, error: `Некорректный адрес: ${addr}` };
    }
  }
  return { ok: true, to, cc, bcc };
}
