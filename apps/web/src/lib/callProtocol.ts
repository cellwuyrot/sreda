/**
 * CALL: общие правила личного звонка — один файл для сервера и клиента.
 *
 * Здесь НЕТ ни prisma, ни узловых модулей: файл импортируется и в окно звонка
 * в браузере, и в сокет-сервер. Один источник важен потому, что расхождение
 * в сроке звонка между сторонами выглядит как зависший вызов: у одного ещё идёт
 * гудок, у другого вызов уже снят.
 */

/**
 * Сколько звонит вызов без ответа.
 *
 * 45 секунд — привычное телефонное ожидание: хватает достать телефон из кармана
 * и разблокировать его, но не превращает пропущенный вызов в минутный звон.
 */
export const CALL_RING_MS = 45_000;

/** Сколько ждём медиа-соединение ПОСЛЕ ответа, прежде чем считать звонок несостоявшимся. */
export const CALL_CONNECT_TIMEOUT_MS = 20_000;

/** Виды служебных сообщений медиа-договорённости. */
export const CALL_SIGNAL_KINDS = ["offer", "answer", "ice", "renegotiate"] as const;

export type CallSignalKind = (typeof CALL_SIGNAL_KINDS)[number];

/**
 * Проверка вида служебного сообщения.
 *
 * Сервер не разбирает содержимое договорённости — он только передаёт её второй
 * стороне, поэтому единственное, что он обязан проверить, — что вид из списка.
 */
export function callSignalKinds(value: unknown): value is CallSignalKind {
  return typeof value === "string" && (CALL_SIGNAL_KINDS as readonly string[]).includes(value);
}

/** Состояние вызова глазами клиента. */
export type CallPhase = "outgoing" | "incoming" | "active" | "ended";

/** Почему вызов завершён — текст для человека собирается из этого. */
export type CallEndReason =
  | "declined"
  | "cancelled"
  | "timeout"
  | "busy"
  | "hangup"
  | "failed"
  | "unavailable";

export const CALL_END_LABELS: Record<CallEndReason, string> = {
  declined: "Звонок отклонён",
  cancelled: "Звонок отменён",
  timeout: "Нет ответа",
  busy: "Абонент занят",
  hangup: "Звонок завершён",
  failed: "Связь не установлена",
  unavailable: "Абонент не в сети",
};

/** Длительность разговора в виде м:сс (или ч:мм:сс после часа). */
export function callDuration(startedAt: number, now: number = Date.now()): string {
  const total = Math.max(0, Math.floor((now - startedAt) / 1000));
  const seconds = total % 60;
  const minutes = Math.floor(total / 60) % 60;
  const hours = Math.floor(total / 3600);
  const mm = hours > 0 ? String(minutes).padStart(2, "0") : String(minutes);
  const ss = String(seconds).padStart(2, "0");
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}
