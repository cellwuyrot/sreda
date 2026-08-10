import prisma from "@/lib/prisma";
import { sendEmail } from "@/lib/email";

/**
 * Письма по обращениям.
 *
 * ── Зачем письмо, если есть уведомление в приложении ────────────────────────
 *
 * Уведомление в колокольчике работает, только пока человек в приложении.
 * Клиент, отправивший заявку на сотрудничество, из приложения уходит и ждёт
 * ответа днями — он узнает об ответе тогда, когда сам вспомнит зайти. У
 * администрации обратная беда: заявка приходит в очередь, а очередь никто не
 * открывает, пока не заглянет. Письмо — единственный канал, который достаёт
 * обоих вне приложения.
 *
 * Отправка идёт через тот же почтовый сервис, что рассылает коды входа
 * (lib/email): отдельной настройки для уведомлений нет и не нужно.
 *
 * ── Кому НЕ пишем ───────────────────────────────────────────────────────────
 *
 * Тому, кто выключил письма (`User.notifyEmail`), и тому, у кого нет адреса.
 * Себе о своём же действии письма не уходят — это решает вызывающий слой
 * (lib/appealNotify), который и так исключает автора действия из получателей.
 *
 * ── Почему функции не ждут отправки ─────────────────────────────────────────
 *
 * Ждут: каждая возвращает промис и его можно проверить в тестах. Но вызывающий
 * слой намеренно не дожидается — у почтового запроса таймаут 15 секунд, и
 * человек, отправивший заявку, не должен смотреть на крутящуюся кнопку, пока
 * администратору уходит письмо. Приложение работает отдельным процессом Node
 * (server.ts), поэтому отправка спокойно доживает до конца после ответа.
 */

interface Recipient {
  email: string;
  name: string;
}

/** Адрес сайта для ссылки в письме. Нет адреса — нет и кнопки. */
function siteUrl(): string {
  return (process.env.NEXTAUTH_URL || "").replace(/\/+$/, "");
}

/** Кому из указанных людей письмо действительно можно отправить. */
async function recipientsFor(userIds: readonly string[]): Promise<Recipient[]> {
  const unique = Array.from(new Set(userIds.filter(Boolean)));
  if (unique.length === 0) return [];
  const users = await prisma.user.findMany({
    where: { id: { in: unique }, notifyEmail: true },
    select: { email: true, name: true },
  });
  return users
    .filter((user: { email: string | null }) => !!user.email)
    .map((user: { email: string | null; name: string | null }) => ({
      email: user.email as string,
      name: user.name ?? "",
    }));
}

/** Обрезка текста для письма: письмо не должно пересказывать всю переписку. */
function excerpt(text: string, limit = 600): string {
  const flat = text.replace(/\r\n/g, "\n").trim();
  return flat.length > limit ? `${flat.slice(0, limit - 1)}…` : flat;
}

/** Экранирование: в тело письма попадает текст человека, а не разметка. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

interface Letter {
  /** Заголовок в шапке письма. */
  title: string;
  /** Первая строка: о чём письмо. */
  intro: string;
  /** Основной текст, если есть: тема обращения, выдержка из ответа. */
  quote?: string;
  /** Подпись кнопки и куда она ведёт. */
  action?: { label: string; path: string };
  /** Строка мелким шрифтом внизу. */
  note?: string;
}

/**
 * Тот же вид, что у писем с кодами: тёмная карточка, фиолетовая шапка. Одно
 * оформление на всю почту проекта — письмо об обращении должно узнаваться как
 * письмо TrioZ, а не выглядеть подделкой.
 */
function renderHtml(letter: Letter): string {
  const url = siteUrl();
  const button =
    letter.action && url
      ? `<div style="text-align:center;margin:0 0 24px">
      <a href="${url}${letter.action.path}" style="display:inline-block;padding:12px 28px;border-radius:10px;background:#8b5cf6;color:#fff;font-size:14px;font-weight:600;text-decoration:none">${escapeHtml(letter.action.label)}</a>
    </div>`
      : "";
  const quote = letter.quote
    ? `<div style="background:#252542;border-left:3px solid #8b5cf6;border-radius:8px;padding:16px 18px;margin:0 0 24px">
      <p style="color:#d7d7ea;font-size:14px;line-height:1.6;margin:0;white-space:pre-wrap">${escapeHtml(letter.quote)}</p>
    </div>`
    : "";
  const note = letter.note
    ? `<p style="color:#6b6b8a;font-size:13px;line-height:1.5;text-align:center;margin:0">${escapeHtml(letter.note)}</p>`
    : "";

  return `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#0f0f17;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#0f0f17;padding:40px 0">
<tr><td align="center">
<table width="480" cellpadding="0" cellspacing="0" style="background:#1a1a2e;border-radius:16px;border:1px solid rgba(139,92,246,0.2);overflow:hidden">

  <tr><td style="background:linear-gradient(135deg,#8b5cf6 0%,#6366f1 100%);padding:32px 40px;text-align:center">
    <div style="display:inline-block;width:56px;height:56px;background:rgba(255,255,255,0.2);border-radius:14px;line-height:56px;color:#fff;font-weight:800;font-size:22px;letter-spacing:1px;margin-bottom:12px">TZ</div>
    <h1 style="margin:8px 0 0;color:#fff;font-size:20px;font-weight:700">${escapeHtml(letter.title)}</h1>
  </td></tr>

  <tr><td style="padding:32px 40px">
    <p style="color:#a5a5c0;font-size:15px;line-height:1.6;margin:0 0 24px">${escapeHtml(letter.intro)}</p>
    ${quote}
    ${button}
    ${note}
  </td></tr>

  <tr><td style="padding:20px 40px;border-top:1px solid rgba(255,255,255,0.05);text-align:center">
    <span style="color:#4a4a6a;font-size:12px">TrioZ Ecosystem</span>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function renderText(letter: Letter): string {
  const url = siteUrl();
  const parts = [letter.title, "", letter.intro];
  if (letter.quote) parts.push("", letter.quote);
  if (letter.action && url) parts.push("", `${url}${letter.action.path}`);
  if (letter.note) parts.push("", letter.note);
  parts.push("", "-- TrioZ Ecosystem");
  return parts.join("\n");
}

/** Одна отправка на каждого получателя. Ошибку глотаем: письмо не главное. */
async function deliver(userIds: readonly string[], subject: string, letter: Letter): Promise<number> {
  const people = await recipientsFor(userIds);
  if (people.length === 0) return 0;
  const html = renderHtml(letter);
  const text = renderText(letter);
  const results = await Promise.all(
    people.map((person) =>
      sendEmail({ to: person.email, subject, html, text }).catch((err) => {
        console.warn("[appealMail] письмо не ушло:", err);
        return false;
      }),
    ),
  );
  return results.filter(Boolean).length;
}

/** Ссылки в письмах ведут туда, где получатель может ответить. */
const STAFF_PATH = "/admin/appeals";
const CLIENT_PATH = "/connect?section=business";

/** Новое обращение — администрации. */
export async function mailNewAppeal(params: {
  userIds: readonly string[];
  authorName: string;
  subject: string;
  body: string;
  isBanAppeal: boolean;
}): Promise<number> {
  return deliver(
    params.userIds,
    params.isBanAppeal ? "Novoe obzhalovanie blokirovki - TrioZ" : "Novoe obrashchenie - TrioZ",
    {
      title: params.isBanAppeal ? "Новое обжалование блокировки" : "Новое обращение",
      intro: `${params.authorName} отправил обращение: «${params.subject}».`,
      quote: excerpt(params.body),
      action: { label: "Открыть обращения", path: STAFF_PATH },
      note: "Письма по обращениям можно выключить: Админская → Уведомления.",
    },
  );
}

/** Ответ по обращению — клиенту. */
export async function mailAppealReplyToClient(params: {
  userId: string;
  subject: string;
  body: string;
}): Promise<number> {
  return deliver([params.userId], "Otvet po vashemu obrashcheniyu - TrioZ", {
    title: "Ответ по вашему обращению",
    intro: `Администрация ответила по обращению «${params.subject}».`,
    quote: excerpt(params.body),
    action: { label: "Открыть бизнес-чат", path: CLIENT_PATH },
    note: "Отвечать можно прямо в чате — переписка сохраняется.",
  });
}

/** Дополнение от клиента — администрации. */
export async function mailAppealReplyToStaff(params: {
  userIds: readonly string[];
  actorName: string;
  subject: string;
  body: string;
}): Promise<number> {
  return deliver(params.userIds, "Dopolnenie k obrashcheniyu - TrioZ", {
    title: "Дополнение к обращению",
    intro: `${params.actorName} дописал по обращению «${params.subject}».`,
    quote: excerpt(params.body),
    action: { label: "Открыть обращения", path: STAFF_PATH },
  });
}

/** Смена состояния обращения — клиенту. */
export async function mailAppealStatus(params: {
  userId: string;
  subject: string;
  statusLabel: string;
}): Promise<number> {
  return deliver([params.userId], "Sostoyanie obrashcheniya izmenilos - TrioZ", {
    title: `Обращение ${params.statusLabel}`,
    intro: `Обращение «${params.subject}» теперь ${params.statusLabel}.`,
    action: { label: "Открыть бизнес-чат", path: CLIENT_PATH },
  });
}
