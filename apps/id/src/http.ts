import type { IncomingMessage, ServerResponse } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { HubError } from "../../web/src/lib/tzIdHub";
export function cookie(req: IncomingMessage, name: string) {
  return (
    (req.headers.cookie || "")
      .split(";")
      .map((p) => p.trim())
      .find((p) => p.startsWith(`${name}=`))
      ?.slice(name.length + 1) || ""
  );
}
export function setCookie(
  res: ServerResponse,
  name: string,
  value: string,
  path = "/",
  maxAge = 172800,
  secure = true,
) {
  const previous = res.getHeader("Set-Cookie");
  res.setHeader("Set-Cookie", [
    ...(Array.isArray(previous)
      ? previous.map(String)
      : previous
        ? [String(previous)]
        : []),
    `${name}=${value}; Path=${path}; Max-Age=${maxAge}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
  ]);
}
export async function bodyOf(
  req: IncomingMessage,
  max = 8192,
): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > max) throw new HubError("Запрос слишком большой", 413);
    chunks.push(buffer);
  }
  const raw = Buffer.concat(chunks).toString("utf8");
  try {
    const data = req.headers["content-type"]?.startsWith("application/json")
      ? JSON.parse(raw)
      : Object.fromEntries(new URLSearchParams(raw));
    if (!data || typeof data !== "object" || Array.isArray(data))
      throw new Error();
    return data;
  } catch {
    throw new HubError("Некорректный запрос");
  }
}
export function checkCsrf(
  req: IncomingMessage,
  token: unknown,
  name: string,
  origin: string,
) {
  const value = cookie(req, name);
  if (
    req.headers.origin !== origin ||
    typeof token !== "string" ||
    !/^[a-f0-9]{64}$/.test(token) ||
    !/^[a-f0-9]{64}$/.test(value) ||
    !timingSafeEqual(Buffer.from(token), Buffer.from(value))
  )
    throw new HubError("Запрос устарел. Обновите страницу", 403);
}
export function json(res: ServerResponse, data: unknown, status = 200) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.end(JSON.stringify(data));
}
