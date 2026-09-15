/** PROJECT-MAIL: единый email-шаблон TrioZ (table+inline стили). */
export const EMAIL_CONTAINER_WIDTH = 620;
export const FONT = "Arial, Helvetica, 'Segoe UI', system-ui, sans-serif";

export interface EmailBrand { productName: string; logoUrl?: string; accent: string; siteUrl: string; footer: string; }

export const DEFAULT_BRAND: EmailBrand = {
  productName: "TrioZ", accent: "#7c3aed", siteUrl: "https://trioz.ru", footer: "TrioZ · trioz.ru · info@trioz.ru",
};

export interface BuildEmailInput { bodyHtml: string; subject?: string; signatureHtml?: string; brand?: Partial<EmailBrand>; }

export function buildEmailHtml(input: BuildEmailInput): string {
  const brand = { ...DEFAULT_BRAND, ...(input.brand || {}) };
  const width = EMAIL_CONTAINER_WIDTH;
  const logo = brand.logoUrl
    ? `<img src="${brand.logoUrl}" alt="${brand.productName}" width="120" style="display:block;border:0;outline:none;" />`
    : `<span style="font-size:22px;font-weight:700;color:#ffffff;">${brand.productName}</span>`;
  const signature = input.signatureHtml
    ? `<tr><td style="padding:0 32px 8px;border-top:1px solid #ececf2;"><div style="padding-top:16px;font:14px/1.6 ${FONT};color:#4b4b57;">${input.signatureHtml}</div></td></tr>`
    : "";
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>${input.subject || brand.productName}</title></head>
<body style="margin:0;padding:0;background:#f4f4f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="${width}" cellpadding="0" cellspacing="0" style="width:${width}px;max-width:100%;background:#ffffff;border-radius:14px;overflow:hidden;box-shadow:0 1px 4px rgba(20,20,40,.08);">
<tr><td style="background:${brand.accent};padding:22px 32px;">${logo}</td></tr>
<tr><td style="padding:28px 32px 8px;font:16px/1.55 ${FONT};color:#1e1e28;">${input.bodyHtml}</td></tr>
${signature}
<tr><td style="padding:20px 32px;background:#fafafc;border-top:1px solid #ececf2;font:12px/1.5 ${FONT};color:#8a8a99;">
${brand.footer}<br /><a href="${brand.siteUrl}" style="color:${brand.accent};text-decoration:none;">${brand.siteUrl}</a>
</td></tr>
</table></td></tr></table></body></html>`;
}

export function extractVariables(text: string): string[] {
  const set = new Set<string>();
  const re = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text || ""))) set.add(m[1]);
  return [...set];
}

export function applyVariables(text: string, vars: Record<string, string>, keepUnknown = true): string {
  return (text || "").replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key) => {
    if (Object.prototype.hasOwnProperty.call(vars || {}, key)) return String(vars[key]);
    return keepUnknown ? full : "";
  });
}
