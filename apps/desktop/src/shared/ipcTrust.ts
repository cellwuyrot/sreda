/** Pure boundary check, shared by IPC and media permission handlers. */
export function trustedAppFrame(frameUrl: string | undefined, topLevel: boolean, appUrl: string): boolean {
  if (!frameUrl || !topLevel) return false;
  try {
    const frame = new URL(frameUrl), app = new URL(appUrl);
    return ["https:", "http:"].includes(frame.protocol) && frame.origin === app.origin;
  } catch { return false; }
}
