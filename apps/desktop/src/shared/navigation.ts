import { BLOCKED_PATHS, DEFAULT_START_PATH } from "./constants";

/**
 * Правила навигации оболочки: что открывается внутри окна, что снаружи, а что
 * не открывается вовсе.
 *
 * ── Почему это отдельный модуль ─────────────────────────────────────────────
 *
 * Раньше эти правила жили внутри mainWindow вместе с созданием окна, и проверить
 * их было нечем: любой импорт тянет за собой electron, а его в тестовой среде
 * нет. При этом ошибка здесь тихая и неприятная — либо в окне мессенджера
 * открывается витрина сайта, либо чужая ссылка загружается вместо приложения,
 * унося сессию туда, куда не следует. Поэтому решения вынесены сюда: ничего,
 * кроме разбора адреса, и каждое покрыто тестом.
 *
 * Все функции чистые: строка на входе, ответ на выходе, никаких обращений к окну.
 */

/**
 * Раздел сайта, которому не место в мессенджере.
 *
 * Это витрина (`/`) и разделы `/projects`, `/pero`, `/library`: оболочка —
 * выделенный клиент TZ.Connect, а не браузер по сайту.
 *
 * Запрос и якорь отбрасываются, хвостовые слэши тоже: `/library/`, `/library?x=1`
 * и `/library/page` — один и тот же раздел, и обход через лишний символ работать
 * не должен.
 */
export function isBlockedPath(pathname: string): boolean {
  const p = (pathname.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
  if (p === "/") return true;
  return BLOCKED_PATHS.some((bp) => p === bp || p.startsWith(`${bp}/`));
}

/** Путь, по которому можно идти: закрытый раздел подменяется началом приложения. */
export function safeInAppPath(pathname: string): string {
  return isBlockedPath(pathname) ? DEFAULT_START_PATH : pathname;
}

/**
 * Ссылка ведёт наружу — её открывает системный браузер, а не окно приложения.
 *
 * Всё, что не http(s), считается внешним: `mailto:`, `tel:` и прочие схемы
 * обязана обрабатывать система. Неразбираемый адрес внешним НЕ считается —
 * загружать его всё равно некуда, и передавать такое браузеру незачем.
 */
export function isExternalUrl(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(appUrl);
    if (target.protocol !== "http:" && target.protocol !== "https:") return true;
    return target.origin !== base.origin;
  } catch {
    return false;
  }
}

/** Переход на свой сайт, но в раздел, которому в оболочке не место. */
export function isBlockedInApp(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(appUrl);
    if (target.origin !== base.origin) return false;
    return isBlockedPath(target.pathname);
  } catch {
    return false;
  }
}

/**
 * Переход внутри приложения, который выполняется полной загрузкой страницы.
 *
 * Вход, выход и API исключены: там меняется сессия, и дерево обязано
 * перезагрузиться целиком. Файлы (со скачиванием) — тоже не маршрут: расширение
 * в конце пути означает файл, а не раздел.
 */
export function isSameOriginDocument(url: string, appUrl: string): boolean {
  try {
    const target = new URL(url);
    const base = new URL(appUrl);
    if (target.origin !== base.origin) return false;
    const path = target.pathname;
    if (path.startsWith("/auth") || path.startsWith("/api") || path.startsWith("/download")) return false;
    return !/\.[a-z0-9]{2,5}$/i.test(path);
  } catch {
    return false;
  }
}

/**
 * Привести адрес сервера к пригодному виду.
 *
 * Адрес приходит из настроек и из переменной окружения — то есть его набирает
 * человек. Годится только http(s): `file:` открыл бы локальный файл с правами
 * приложения, а неразбираемая строка просто не загрузится. В обоих случаях
 * лучше вернуться к рабочему значению, чем оставить окно пустым.
 */
export function sanitizeAppUrl(url: string | undefined, fallback: string): string {
  if (!url) return fallback;
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;
    return parsed.origin + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    return fallback;
  }
}
