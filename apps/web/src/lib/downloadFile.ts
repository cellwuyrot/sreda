/**
 * Скачивание вложения — один путь на все три оболочки.
 *
 * Логика целиком взята из DocsPanel, где она уже отлажена на живых клиентах.
 * Здесь она оказалась потому, что теперь скачивать надо не только документы, но и
 * картинки — из контекстного меню и из лайтбокса. Копировать её в три места
 * было бы ровно той же ошибкой, что и четыре списка типов вложений.
 *
 * Почему не blob. Предыдущий вариант через `fetch` + `URL.createObjectURL`
 * в браузере работал, но ломался в обоих оболочках:
 *
 *   • Electron: перехватчик скачиваний смотрит на путь `/uploads/`, а `blob:` идёт
 *     мимо него — диалог выбора папки открывался, а файл до диска не доходил.
 *   • Android: DownloadManager схему `blob:` не поддерживает вовсе.
 *
 * Поэтому скачивание идёт по НАСТОЯЩЕМУ сетевому URL с `?dl=1&name=`: сервер
 * (см. server.ts) отвечает заголовком `Content-Disposition: attachment` с настоящим
 * именем файла, и каждая оболочка видит привычный ей запрос.
 */

import { isAndroidShell } from "@/lib/shell";
import { isDesktop } from "@/lib/desktop";

/**
 * URL для скачивания: тот же адрес плюс `dl=1` и имя.
 *
 * Имя передаётся отдельно, потому что на диске файл лежит под uuid: без `name`
 * человек скачает «8f3c….webp» вместо «Скриншот.webp».
 */
export function downloadUrl(url: string, name?: string): string {
  const separator = url.includes("?") ? "&" : "?";
  const suffix = name ? `&name=${encodeURIComponent(name)}` : "";
  return `${url}${separator}dl=1${suffix}`;
}

/**
 * Запускает скачивание файла тем способом, который работает в текущей оболочке.
 *
 * Ветки нарочно разные, а не «один универсальный способ», потому что универсального
 * способа нет — проверено на предыдущей реализации.
 */
export function startFileDownload(url: string, name?: string): void {
  if (typeof window === "undefined") return;
  const href = downloadUrl(url, name);

  /* Android: DownloadListener в WebView срабатывает только на настоящей навигации,
     поэтому ссылку не «кликаем», а переходим по ней.

     Именно `assign`, а не присваивание `location.href`: правило
     react-hooks/immutability запрещает менять значения, объявленные вне
     компонента, а вызов метода под запрет не попадает. */
  if (isAndroidShell()) {
    window.location.assign(href);
    return;
  }

  /* Десктоп-оболочка: обработчик открытия окна видит путь /uploads/ и отдаёт
     файл через downloadURL. */
  if (isDesktop()) {
    window.open(href, "_blank", "noopener");
    return;
  }

  /* Обычный браузер: временная ссылка с `download`. Атрибут здесь подсказка,
     а не гарантия: имя всё равно приходит с сервера в Content-Disposition. */
  const anchor = document.createElement("a");
  anchor.href = href;
  if (name) anchor.download = name;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
}
