/**
 * Keybind helpers shared by the settings UI and the voice engine.
 *
 * Two different keybind "dialects" live in this app:
 *
 *  1. **Browser binds** — arrays like `["Shift", "q"]` that
 *     `VoiceContext` matches against live `KeyboardEvent`s while the window is
 *     focused (used for in-app push-to-talk). Modifiers are the capitalised
 *     names `Control | Alt | Shift | Meta`; ordinary keys are `e.key`
 *     (lower-cased when a single character, e.g. `q`, otherwise `ArrowUp`).
 *
 *  2. **Electron accelerators** — strings like `"CommandOrControl+Shift+M"`
 *     that the desktop shell registers as *global* (system-wide) hotkeys via
 *     `globalShortcut`. These follow Electron's Accelerator grammar.
 *
 * Recording a keybind means turning one `KeyboardEvent` into the right dialect;
 * displaying one means turning the stored value into something human-readable.
 */

const BROWSER_MODIFIERS = ["Control", "Alt", "Shift", "Meta"] as const;

function isMac(): boolean {
  if (typeof navigator === "undefined") return false;
  return /mac|iphone|ipad|ipod/i.test(navigator.platform || navigator.userAgent);
}

/* ─────────────────────────── Browser binds ─────────────────────────── */

/** Turn a keyboard event into the `["Shift", "q"]`-style array VoiceContext expects. */
export function eventToBrowserKeys(e: KeyboardEvent): string[] {
  const keys: string[] = [];
  if (e.ctrlKey) keys.push("Control");
  if (e.altKey) keys.push("Alt");
  if (e.shiftKey) keys.push("Shift");
  if (e.metaKey) keys.push("Meta");
  const k = e.key;
  if (!BROWSER_MODIFIERS.includes(k as (typeof BROWSER_MODIFIERS)[number])) {
    keys.push(k.length === 1 ? k.toLowerCase() : k);
  }
  return keys;
}

/** A bind is only usable if it contains at least one non-modifier key. */
export function browserKeysHaveMainKey(keys: string[]): boolean {
  return keys.some((k) => !BROWSER_MODIFIERS.includes(k as (typeof BROWSER_MODIFIERS)[number]));
}

const KEY_LABELS: Record<string, string> = {
  Control: "Ctrl",
  Alt: "Alt",
  Shift: "Shift",
  " ": "Space",
  ArrowUp: "↑",
  ArrowDown: "↓",
  ArrowLeft: "←",
  ArrowRight: "→",
  Escape: "Esc",
};

/** Human-readable label for a browser bind, e.g. `Shift + Q`. */
export function formatBrowserKeys(keys: string[]): string {
  if (!keys.length) return "—";
  const meta = isMac() ? "⌘" : "Win";
  return keys
    .map((k) => {
      if (k === "Meta") return meta;
      if (KEY_LABELS[k]) return KEY_LABELS[k];
      return k.length === 1 ? k.toUpperCase() : k;
    })
    .join(" + ");
}

/* ───────────────────────── Electron accelerators ───────────────────────── */

/**
 * Map a browser `KeyboardEvent.code`/`key` to a valid Electron Accelerator key
 * token. Returns `null` when the pressed key is a bare modifier (an accelerator
 * always needs one "real" key).
 */
function eventToAcceleratorKey(e: KeyboardEvent): string | null {
  const code = e.code;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3); // KeyM -> M
  if (/^Digit[0-9]$/.test(code)) return code.slice(5); // Digit4 -> 4
  if (/^F([1-9]|1[0-9]|2[0-4])$/.test(code)) return code; // F1..F24
  const map: Record<string, string> = {
    Space: "Space",
    Enter: "Return",
    Tab: "Tab",
    Backspace: "Backspace",
    Delete: "Delete",
    Escape: "Escape",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
    Home: "Home",
    End: "End",
    PageUp: "PageUp",
    PageDown: "PageDown",
    Minus: "-",
    Equal: "=",
    BracketLeft: "[",
    BracketRight: "]",
    Semicolon: ";",
    Quote: "'",
    Comma: ",",
    Period: ".",
    Slash: "/",
    Backslash: "\\",
    Backquote: "`",
  };
  return map[code] ?? null;
}

/**
 * Turn a keyboard event into an Electron accelerator string such as
 * `"CommandOrControl+Shift+M"`, or `null` if the combination has no main key.
 */
export function eventToAccelerator(e: KeyboardEvent): string | null {
  const key = eventToAcceleratorKey(e);
  if (!key) return null;
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push("CommandOrControl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");
  parts.push(key);
  return parts.join("+");
}

/** Human-readable label for an Electron accelerator, e.g. `Ctrl + Shift + M`. */
export function formatAccelerator(accelerator: string): string {
  if (!accelerator) return "—";
  const cmd = isMac() ? "⌘" : "Ctrl";
  return accelerator
    .split("+")
    .map((p) => {
      if (p === "CommandOrControl" || p === "CmdOrCtrl") return cmd;
      if (p === "Command" || p === "Cmd" || p === "Super" || p === "Meta") return isMac() ? "⌘" : "Win";
      if (p === "Control") return "Ctrl";
      return p;
    })
    .join(" + ");
}
