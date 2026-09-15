export const EMAIL_CONTAINER_WIDTH = 620;
export const FONT = "Arial, Helvetica, 'Segoe UI', system-ui, sans-serif";

export interface EmailBrand { name: string; logoUrl?: string; accent: string; footer: string; siteUrl?: string; }
export const DEFAULT_BRAND: EmailBrand = {
  name: "TrioZ",
  logoUrl: "https://trioz.ru/logo.png",
  accent: "#7c3aed",
  footer: "TrioZ · trioz.ru · support@trioz.ru",
  siteUrl: "https://trioz.ru",
};

export function buildEmailHtml(opts: { bodyHtml: string; subject?: string; signatureHtml?: string; brand?: EmailBrand }): string {
  const b = opts.brand || DEFAULT_BRAND;
  const sig = opts.signatureHtml ? `<div style="margin-top:24px;padding-top:16px;border-top:1px solid #eeeeee;color:#555555;font-size:14px;">${opts.signatureHtml}</div>` : "";
  return `<!DOCTYPE html>
<html lang="ru"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1.0" /><title>${opts.subject || b.name}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;"><tr><td align="center">
<table role="presentation" width="${EMAIL_CONTAINER_WIDTH}" cellpadding="0" cellspacing="0" style="width:${EMAIL_CONTAINER_WIDTH}px;max-width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:${FONT};">
<tr><td style="padding:20px 32px;background:${b.accent};"><img src="${b.logoUrl}" alt="${b.name}" height="28" style="height:28px;" /></td></tr>
${opts.subject ? `<tr><td style="padding:24px 32px 0;"><h1 style="margin:0;font-size:22px;line-height:1.3;color:#1a1a2e;">${opts.subject}</h1></td></tr>` : ""}
<tr><td style="padding:16px 32px 24px;font-size:16px;line-height:1.6;color:#1a1a2e;">${opts.bodyHtml}${sig}</td></tr>
<tr><td style="padding:16px 32px;background:#fafafc;color:#8a8aa0;font-size:12px;line-height:1.5;text-align:center;">${b.footer}</td></tr>
</table></td></tr></table></body></html>`;
}

export function extractVariables(text: string): string[] {
  const out: string[] = []; const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g; let m;
  while ((m = re.exec(String(text || "")))) if (!out.includes(m[1])) out.push(m[1]);
  return out;
}

export function applyVariables(text: string, vars: Record<string, string>, keepUnknown = true): string {
  return String(text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (m, key) => {
    if (Object.prototype.hasOwnProperty.call(vars || {}, key) && vars[key] !== undefined && vars[key] !== "") return String(vars[key]);
    return keepUnknown ? m : "";
  });
}
