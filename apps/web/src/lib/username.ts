// Единое место правил про юзернейм (ник).
//
// До этого модуля правила были продублированы в двух местах и разошлись:
// `api/profile/route.ts` требовал `/^[a-zA-Z0-9_]{6,20}$/` (6–20 символов),
// а `api/users/[id]/route.ts` (админская смена) — `/^[a-zA-Z0-9_]+$/` с
// длиной 3–20. При этом форма в настройках профиля обещала пользователю
// «3–20 символов» — то есть сервер на самостоятельной смене ника был строже,
// чем обещал интерфейс, и пользователь получал непонятную ошибку валидации,
// хотя формально соответствовал форме. Приводим длину к 3–20 везде и держим
// регулярку/сообщения в одном месте, чтобы больше не расходились.
//
// Файл сознательно без импортов — он используется и в серверных API-роутах,
// и (потенциально) в клиентских компонентах формы настроек.

export const USERNAME_MIN = 3;
export const USERNAME_MAX = 20;

// Как часто обычный пользователь может сам сменить ник (администратор не ограничен).
export const USERNAME_COOLDOWN_DAYS = 14;

export type UsernameValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

/**
 * Проверяет и нормализует юзернейм: снимает пробелы по краям и ведущий "@"
 * (частая опечатка, если человек копирует ник из чата), затем проверяет длину
 * и допустимые символы.
 */
export function validateUsername(raw: unknown): UsernameValidationResult {
  if (typeof raw !== "string") {
    return { ok: false, error: "Ник должен быть строкой" };
  }

  let value = raw.trim();
  if (value.startsWith("@")) {
    value = value.slice(1);
  }

  if (value.length < USERNAME_MIN || value.length > USERNAME_MAX) {
    return { ok: false, error: `Ник должен быть от ${USERNAME_MIN} до ${USERNAME_MAX} символов` };
  }

  if (!/^[a-zA-Z0-9_]+$/.test(value)) {
    return { ok: false, error: "Ник может содержать только латинские буквы, цифры и подчёркивание" };
  }

  return { ok: true, value };
}

/**
 * Сколько ещё осталось ждать до следующей смены ника, в миллисекундах.
 * 0 — менять можно прямо сейчас (в том числе если ник ещё ни разу не меняли).
 */
export function usernameCooldownLeftMs(changedAt: Date | null | undefined): number {
  if (!changedAt) return 0;

  const cooldownMs = USERNAME_COOLDOWN_DAYS * 24 * 60 * 60 * 1000;
  const elapsed = Date.now() - changedAt.getTime();
  const left = cooldownMs - elapsed;

  return left > 0 ? left : 0;
}

/**
 * Человекочитаемое «сколько осталось» для сообщения об ошибке:
 * «ещё 9 дней», «ещё 3 часа», «меньше часа».
 */
export function formatCooldownLeft(ms: number): string {
  if (ms <= 0) return "уже можно";

  const hourMs = 60 * 60 * 1000;
  const dayMs = 24 * hourMs;

  if (ms < hourMs) {
    return "меньше часа";
  }

  if (ms < dayMs) {
    const hours = Math.ceil(ms / hourMs);
    return `ещё ${hours} ${pluralize(hours, "час", "часа", "часов")}`;
  }

  const days = Math.ceil(ms / dayMs);
  return `ещё ${days} ${pluralize(days, "день", "дня", "дней")}`;
}

/** Русское склонение по числу: 1 → one, 2–4 → few, 5+ (и 11–14) → many. */
function pluralize(n: number, one: string, few: string, many: string): string {
  const mod10 = n % 10;
  const mod100 = n % 100;

  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}
