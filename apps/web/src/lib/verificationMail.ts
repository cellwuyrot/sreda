/**
 * AUTH-MAIL: единый контент писем с кодами подтверждения.
 *
 * Содержимое не зависит от SMTP/Prisma и поэтому может тестироваться отдельно.
 * Доставка выполняется через внутренний mailbox-процесс noreply@trioz.ru.
 */

export type VerificationMailType = "register" | "login" | "reset";

const SUBJECTS: Record<VerificationMailType, string> = {
  register: "Kod podtverzhdeniya registracii - TrioZ",
  login: "Kod dlya vhoda - TrioZ",
  reset: "Sbros parolya - TrioZ",
};

const TITLES: Record<VerificationMailType, string> = {
  register: "Подтверждение регистрации",
  login: "Вход в аккаунт",
  reset: "Сброс пароля",
};

const DESCRIPTIONS: Record<VerificationMailType, string> = {
  register: "Используйте этот код для завершения регистрации:",
  login: "Используйте этот код для входа в аккаунт:",
  reset: "Используйте этот код для сброса пароля:",
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export interface VerificationMailContent {
  subject: string;
  html: string;
  text: string;
}

export function buildVerificationMail(code: string, type: VerificationMailType): VerificationMailContent {
  const safeCode = escapeHtml(code);
  const title = TITLES[type];
  const description = DESCRIPTIONS[type];
  const subject = SUBJECTS[type];

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f17;padding:40px 0">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;border:1px solid rgba(139,92,246,0.2);overflow:hidden">
<tr><td style="background:linear-gradient(135deg,#8b5cf6 0%,#6366f1 100%);padding:32px 40px;text-align:center">
  <div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:14px;line-height:56px;color:#fff;font-weight:800;font-size:22px;letter-spacing:1px;margin-bottom:12px">TZ</div>
  <h1 style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:700">${title}</h1>
</td></tr>
<tr><td style="padding:32px 40px">
  <p style="color:#a5a5c0;font-size:15px;line-height:1.6;margin:0 0 24px;text-align:center">${description}</p>
  <div style="background:#252542;border:2px solid #8b5cf6;border-radius:12px;padding:24px;text-align:center;margin:0 0 24px">
    <span style="font-size:36px;font-weight:800;letter-spacing:10px;color:#c4b5fd">${safeCode}</span>
  </div>
  <p style="color:#6b6b8a;font-size:13px;line-height:1.5;text-align:center;margin:0">
    Код действителен 10 минут.<br>
    Если вы не запрашивали этот код, проигнорируйте это письмо.
  </p>
</td></tr>
<tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.05);text-align:center">
  <span style="color:#4a4a6a;font-size:12px">TrioZ Ecosystem · noreply@trioz.ru</span>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const text = `${title}\n\n${description}\n\n${code}\n\nКод действителен 10 минут.\nЕсли вы не запрашивали этот код, проигнорируйте это письмо.\n\n-- TrioZ Ecosystem <noreply@trioz.ru>`;

  return { subject, html, text };
}
