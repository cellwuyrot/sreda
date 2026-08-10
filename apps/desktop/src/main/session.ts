import { session } from "electron";

/**
 * Read all cookies Electron holds for the given origin and serialize them into
 * a single `Cookie:` header value.
 *
 * The desktop shell never handles passwords itself — the user signs in through
 * the normal NextAuth web flow inside the BrowserWindow, and Electron persists
 * the resulting JWT session cookie in its default (disk-backed) session
 * partition. We reuse that exact cookie to authenticate the main-process
 * Socket.IO client, so there is a single source of truth for the session.
 */
export async function getCookieHeader(appUrl: string): Promise<string> {
  try {
    const url = new URL(appUrl);
    const cookies = await session.defaultSession.cookies.get({ url: url.origin });
    return cookies.map((c) => `${c.name}=${c.value}`).join("; ");
  } catch {
    return "";
  }
}

/**
 * True when a NextAuth session cookie is present for the origin. Used to decide
 * whether it is worth opening the notification socket yet.
 */
export async function hasSession(appUrl: string): Promise<boolean> {
  try {
    const url = new URL(appUrl);
    const cookies = await session.defaultSession.cookies.get({ url: url.origin });
    return cookies.some((c) => c.name.includes("next-auth.session-token"));
  } catch {
    return false;
  }
}
