/**
 * Единственное правило разбора @-упоминаний для клиента и сервера.
 *
 * Упоминание — отдельный токен. Собачка внутри слова/e-mail и после `/`
 * (URL вида /@user) намеренно не считается началом токена.
 */
export interface MentionToken {
  value: string;
  normalized: string;
  start: number;
  end: number;
  everyone: boolean;
}

const USERNAME_CHAR = /[A-Za-z0-9_а-яА-ЯёЁ]/;
const TOKEN_RE = /@(everyone|[A-Za-z0-9_а-яА-ЯёЁ]+)/gi;

function hasValidPrefix(text: string, start: number): boolean {
  if (start === 0) return true;
  const before = text[start - 1];
  return !USERNAME_CHAR.test(before) && before !== "@" && before !== "/" && before !== "\\";
}

function hasValidSuffix(text: string, end: number): boolean {
  if (end >= text.length) return true;
  const after = text[end];
  if (USERNAME_CHAR.test(after) || after === "@" || after === "/" || after === "\\") return false;
  // `@ivan.com` — адрес/домен, а `@ivan.` в конце предложения — mention.
  if (after === "." && end + 1 < text.length && USERNAME_CHAR.test(text[end + 1])) return false;
  return true;
}

export function parseMentions(text: string): MentionToken[] {
  if (!text || !text.includes("@")) return [];
  TOKEN_RE.lastIndex = 0;
  const result: MentionToken[] = [];
  let match: RegExpExecArray | null;
  while ((match = TOKEN_RE.exec(text)) !== null) {
    const start = match.index;
    const end = start + match[0].length;
    if (!hasValidPrefix(text, start) || !hasValidSuffix(text, end)) continue;
    const normalized = match[1].toLowerCase();
    result.push({
      value: match[1],
      normalized,
      start,
      end,
      everyone: normalized === "everyone",
    });
  }
  return result;
}

export function hasEveryoneMention(text: string): boolean {
  return parseMentions(text).some((token) => token.everyone);
}

export interface MentionMember {
  id: string;
  username?: string | null;
}

/** Разрешает токены только в реальных участников переданного сообщества. */
export function resolveMentionIds(text: string, members: MentionMember[]): string[] {
  const tokens = parseMentions(text);
  if (tokens.length === 0) return [];
  const names = new Set(tokens.filter((token) => !token.everyone).map((token) => token.normalized));
  return members
    .filter((member) => member.username && names.has(member.username.toLowerCase()))
    .map((member) => member.id);
}

/** Тот же префиксный boundary, но для ещё не законченного токена в textarea. */
export function findMentionQuery(text: string, caret: number): { query: string; start: number } | null {
  const upto = text.slice(0, caret);
  const at = upto.lastIndexOf("@");
  if (at < 0 || !hasValidPrefix(upto, at)) return null;
  const query = upto.slice(at + 1);
  if (!/^[A-Za-z0-9_а-яА-ЯёЁ]*$/.test(query)) return null;
  return { query: query.toLowerCase(), start: at };
}