/**
 * VPN-ANDROID: типизированный мост к нативному VPN-сервису Android-оболочки.
 *
 * Зеркалит `DesktopVpnApi` из `lib/desktop.ts` — API намеренно одинаковое,
 * чтобы `PremiumInfoModal` мог работать с обоими через один интерфейс.
 *
 * Оболочка добавляет `window.TriozVpnBridge` через `addJavascriptInterface`;
 * в браузере его нет — всегда делай feature-detect через `getAndroidVpnBridge()`.
 *
 * Состояние приходит двумя путями:
 *   1. Синхронно через `bridge.status()` — при первом открытии окна.
 *   2. Асинхронно через `window.__androidVpnState(jsonStr)` — при каждом
 *      изменении (MainActivity вызывает `evaluateJavascript`).
 *
 * @module
 */

import type { DesktopVpnState } from "@/lib/desktop";

/** Форма bridge-объекта, который Android регистрирует в WebView. */
interface AndroidVpnBridgeRaw {
  /** Поднять туннель. Возвращает JSON-строку состояния (synchronous). */
  up(config: string): string;
  /** Снять туннель. Возвращает JSON-строку состояния. */
  down(): string;
  /** Текущее состояние — синхронная строка JSON. */
  status(): string;
}

declare global {
  interface Window {
    TriozVpnBridge?: AndroidVpnBridgeRaw;
    /** Вызывается из MainActivity когда состояние изменилось. */
    __androidVpnState?: (json: string) => void;
  }
}

type Unsubscribe = () => void;

/**
 * Высокоуровневый API — зеркало `DesktopVpnApi`.
 *
 * Методы `up` и `down` — асинхронные (Promise), потому что после вызова
 * нативного bridge Android показывает системный диалог разрешения VPN,
 * а реальный ответ придёт позже через `__androidVpnState`.
 */
export interface AndroidVpnApi {
  up(config: string): Promise<DesktopVpnState>;
  down(): Promise<DesktopVpnState>;
  status(): Promise<DesktopVpnState>;
  onState(cb: (state: DesktopVpnState) => void): Unsubscribe;
}

function parseState(json: string): DesktopVpnState {
  try {
    return JSON.parse(json) as DesktopVpnState;
  } catch {
    return { state: "error", since: null, error: "Некорректный ответ моста", backend: null };
  }
}

/** Список подписчиков на изменения состояния. */
const listeners = new Set<(state: DesktopVpnState) => void>();

/**
 * Устанавливаем глобальный хук один раз.
 * MainActivity вызывает `window.__androidVpnState(jsonStr)` при каждом
 * изменении — это аналог `IPC.VPN_STATE` из десктопа.
 */
function ensureGlobalHook(): void {
  if (typeof window === "undefined") return;
  if (window.__androidVpnState) return;
  window.__androidVpnState = (json: string) => {
    const state = parseState(json);
    listeners.forEach((cb) => cb(state));
  };
}

/**
 * Возвращает типизированный API или `null`, если мы не в Android-оболочке.
 */
export function getAndroidVpnBridge(): AndroidVpnApi | null {
  if (typeof window === "undefined") return null;
  const raw = window.TriozVpnBridge;
  if (!raw) return null;

  ensureGlobalHook();

  return {
    async up(config: string): Promise<DesktopVpnState> {
      // bridge.up() запускает сервис и сразу возвращает {state:"connecting"}.
      // Реальный переход в "on" или "error" придёт через __androidVpnState.
      const json = raw.up(config);
      return parseState(json);
    },

    async down(): Promise<DesktopVpnState> {
      const json = raw.down();
      return parseState(json);
    },

    async status(): Promise<DesktopVpnState> {
      const json = raw.status();
      return parseState(json);
    },

    onState(cb: (state: DesktopVpnState) => void): Unsubscribe {
      ensureGlobalHook();
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
  };
}
