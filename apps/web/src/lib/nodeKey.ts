/**
 * NODE-KEY: одна строка вместо шести полей в форме добавления VPN-узла.
 *
 * Зачем вообще отдельный формат. Узлу с маскировкой недостаточно адреса и
 * ключа: вместе с ними на клиент обязаны попасть одиннадцать чисел, совпадающих с
 * узлом побайтово. Перенос их руками гарантированно заканчивается опечаткой в одном
 * числе, а последствие опечатки — туннель, который молча не встаёт: узел просто
 * отбрасывает пакеты с неверными заголовками, не пишет в журнал ни строки и
 * не отвечает ошибкой. Именно такая картина и наблюдалась: рукопожатие есть,
 * трафика нет.
 *
 * Формат: `TRIOZ-NODE-<base64(JSON)>`, его печатает `deploy/awg-node.sh`.
 *
 * Ключ — СЕКРЕТ: внутри лежит токен агента. Не логгируется и не возвращается
 * наружу ни целиком, ни частями — поэтому тексты ошибок здесь говорят о том, ЧТО
 * не так, и никогда не показывают само значение.
 */

import { isValidAwgParams, isAllowedEndpointPort, awgProblem, AWG_KEYS } from "@/lib/awgParams";
import { isValidWireGuardKey } from "@/lib/vpn";

export const NODE_KEY_PREFIX = "TRIOZ-NODE-";

export interface ParsedNodeKey {
  host: string;
  port: number;
  publicKey: string;
  /** Токен агента в открытом виде. В базу ложится только его SHA-256. */
  token: string;
  /** Подсеть туннеля узла, например 10.8.0.0/24. */
  subnet: string;
  /** Набор маскировки узла: все одиннадцать значений. */
  awg: Record<string, number>;
}

/** Имя или IP без схемы и порта. Клиент пишет это в Endpoint как есть. */
const HOST_RE = /^[a-z0-9.:-]{3,253}$/i;

/**
 * Разбор ключа узла. Ошибка — строка на русском для показа администратору,
 * успешный разбор — готовая запись узла.
 *
 * Проверяется всё и сразу: частично верный ключ хуже неверного — узел появится
 * в списке и начнёт выдавать профили, которые не работают.
 */
export function parseNodeKey(raw: unknown): { node: ParsedNodeKey } | { error: string } {
  if (typeof raw !== "string" || !raw.trim()) return { error: "Вставьте ключ узла" };

  /* Пробелы и переводы строк вставляются вместе с ключом при копировании из
     терминала — терминал ломает длинную строку по ширине окна. */
  let value = raw.replace(/\s+/g, "");
  if (value.startsWith(NODE_KEY_PREFIX)) value = value.slice(NODE_KEY_PREFIX.length);
  else return { error: "Не похоже на ключ узла: он начинается с TRIOZ-NODE-" };

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64").toString("utf8"));
  } catch {
    return { error: "Ключ повреждён: не удалось разобрать содержимое. Скопируйте строку целиком" };
  }
  if (!parsed || typeof parsed !== "object") return { error: "Ключ повреждён" };

  const body = parsed as Record<string, unknown>;
  if (body.v !== 1) return { error: "Неизвестная версия ключа — обновите скрипт узла или панель" };

  const host = typeof body.host === "string" ? body.host.trim().toLowerCase() : "";
  if (!HOST_RE.test(host)) return { error: "В ключе нет корректного адреса узла" };

  const port = typeof body.port === "number" ? body.port : Number(body.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { error: "В ключе неверный порт" };
  if (!isAllowedEndpointPort(port)) {
    return { error: `Порт ${port} не входит в список разрешённых — перезапустите скрипт узла с --port=51820` };
  }

  const publicKey = typeof body.pub === "string" ? body.pub.trim() : "";
  if (!isValidWireGuardKey(publicKey)) return { error: "В ключе неверный публичный ключ узла" };

  const token = typeof body.token === "string" ? body.token.trim() : "";
  if (token.length < 32 || token.length > 200) return { error: "В ключе нет токена агента" };

  const subnet = typeof body.subnet === "string" && /^\d+\.\d+\.\d+\.0\/24$/.test(body.subnet)
    ? body.subnet
    : "10.8.0.0/24";

  /* Набор маскировки проверяется тем же кодом, что и при ручном вводе в
     панели: две разные проверки разошлись бы через месяц и дали узлу, который
     прошёл одну и не прошёл другую. */
  const awgRaw = body.awg;
  if (!awgRaw || typeof awgRaw !== "object") return { error: "В ключе нет параметров маскировки" };
  const awg: Record<string, number> = {};
  for (const key of AWG_KEYS) {
    const v = (awgRaw as Record<string, unknown>)[key];
    const n = typeof v === "number" ? v : Number(v);
    if (!Number.isInteger(n)) return { error: `Параметр маскировки ${key} в ключе отсутствует или не число` };
    awg[key] = n;
  }
  const problem = awgProblem(awg);
  if (problem) return { error: `Набор маскировки из ключа непригоден: ${problem}` };
  if (!isValidAwgParams(awg)) return { error: "Набор маскировки из ключа непригоден" };

  return { node: { host, port, publicKey, token, subnet, awg } };
}

/** Сборка ключа — нужна только тестам и отладочным сценариям. */
export function buildNodeKey(node: ParsedNodeKey): string {
  const json = JSON.stringify({
    v: 1,
    host: node.host,
    port: node.port,
    pub: node.publicKey,
    token: node.token,
    subnet: node.subnet,
    awg: node.awg,
  });
  return NODE_KEY_PREFIX + Buffer.from(json, "utf8").toString("base64");
}
