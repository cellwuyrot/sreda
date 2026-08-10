/**
 * ANDROID-NOTIFY: единая точка показа уведомления «снаружи приложения».
 *
 * Проблема: веб-часть показывала уведомления только через Web Notifications API
 * (`new Notification(...)`). **Android WebView его не реализует** — объекта
 * `Notification` в WebView нет вовсе, поэтому в мобильном клиенте уведомления
 * приходили по Socket.IO, звук играл, но система Android их не показывала: ни в
 * шторке, ни на экране блокировки.
 *
 * Решение: тонкий фасад. Если страница открыта внутри Android-оболочки, зовём
 * JS-интерфейс `AndroidNotify` (см. `NotificationBridge.kt`), который постит
 * настоящее системное уведомление через `NotificationManagerCompat`. В обычном
 * браузере поведение прежнее — Web Notifications. В Electron-оболочке ничего не
 * делаем: там тосты показывает main-процесс (иначе будет дубль).
 */

import { isAndroidShell } from "@/lib/shell";
import { notifyPushAllowed } from "@/lib/notifyPrefs";

/** JS-интерфейс, который оболочка добавляет в WebView (@JavascriptInterface). */
interface AndroidNotifyBridge {
  /** Показать системное уведомление. `tag` схлопывает повторы одной беседы. */
  notify(title: string, body: string, tag: string): void;
  /** Запросить у системы разрешение POST_NOTIFICATIONS (Android 13+). */
  requestPermission?(): void;
  /** Разрешены ли уведомления в системных настройках приложения. */
  areNotificationsEnabled?(): boolean;
  /**
   * PUSH: адрес устройства в службе доставки — нужен, чтобы уведомления доходили
   * в ЗАКРЫТОЕ приложение. Привязку выполняет страница (см. hooks/usePushDevice):
   * сессия есть у неё, а не у оболочки.
   */
  pushToken?(): string;
}

function bridge(): AndroidNotifyBridge | null {
  if (typeof window === "undefined") return null;
  const api = (window as unknown as { AndroidNotify?: AndroidNotifyBridge }).AndroidNotify;
  return api && typeof api.notify === "function" ? api : null;
}

/**
 * Показать уведомление о новом сообщении.
 *
 * Вызывать ТОЛЬКО когда приложение не на переднем плане (`document.hidden`) —
 * решение принимает вызывающий код, как и раньше.
 */
export function notifyExternal(title: string, body: string, tag: string): void {
  /* «Push-уведомления» в настройках аккаунта. Проверка стоит здесь, а не у
     вызывающих: для личных сообщений её делал сервер (pushEnabled в payload), а
     сообщения каналов уходили мимо неё — выключенный пуш их не отключал. */
  if (!notifyPushAllowed()) return;

  const android = bridge();
  if (android) {
    try {
      android.notify(title, body, tag);
    } catch {
      /* оболочка старой версии без моста — молча пропускаем */
    }
    return;
  }

  // Обычный браузер (в т.ч. мобильный Chrome): прежнее поведение.
  if (typeof Notification !== "undefined" && Notification.permission === "granted") {
    try {
      new Notification(title, { body, tag, icon: "/favicon.ico" });
    } catch {
      /* Safari/iOS может бросить без ServiceWorker — не критично */
    }
  }
}

/**
 * Запросить разрешение на уведомления при входе в мессенджер.
 *
 * В Android-оболочке это системный диалог POST_NOTIFICATIONS (Android 13+),
 * в браузере — обычный запрос Web Notifications.
 */
export function requestNotifyPermission(): void {
  const android = bridge();
  if (android) {
    try {
      if (android.areNotificationsEnabled?.() === false) android.requestPermission?.();
      else if (!android.areNotificationsEnabled) android.requestPermission?.();
    } catch {
      /* мост старой версии — пропускаем */
    }
    return;
  }
  if (typeof Notification !== "undefined" && Notification.permission === "default") {
    Notification.requestPermission().catch(() => {});
  }
}

/** true, когда уведомления показывает нативная Android-оболочка. */
export function isAndroidNotifyAvailable(): boolean {
  return isAndroidShell() && !!bridge();
}
