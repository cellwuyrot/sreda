/**
 * BUILDS: сборка клиентских приложений на сервере.
 *
 * Раньше APK и установщик Windows собирались руками на своём ПК и заливались на
 * сервер. Это работает ровно до того дня, когда нужного ПК нет под рукой, — и
 * никак не проверяется: что именно собрано и из какого кода, знает только тот,
 * кто собирал.
 *
 * Теперь очередь живёт в базе, а работу делает отдельный процесс — агент сборки
 * (`apps/builder`). Здесь только чистые правила этой очереди: без базы, без
 * сети и без времени по часам процесса, чтобы их можно было проверить целиком.
 *
 * ── Почему отдельный процесс, а не «собрать прямо в обработчике запроса» ─────
 *
 * Сборка идёт минуты и ест всю машину. Запрос столько не живёт, перезапуск
 * приложения оборвал бы сборку на середине, а падение сборки уронило бы сайт.
 * Агент переживает и деплой, и перезапуск: он просто берёт следующую задачу.
 *
 * Из этого же следует главное свойство: агент общается с сервером по HTTP и
 * токену. Сегодня он работает на главном сервере — как и просили, — но перенести
 * сборку на отдельную машину (в том числе на настоящую Windows) можно, не меняя
 * ни строчки кода: переезжает служба, а не логика.
 *
 * ── Одна сборка за раз ───────────────────────────────────────────────────────
 *
 * Намеренное ограничение. Gradle и electron-builder каждый забирают несколько
 * гигабайт памяти; две параллельные сборки на машине, которая обслуживает
 * пользователей, — это не «в два раза быстрее», а «сайт не отвечает».
 */

export const BUILD_TARGETS = ["ANDROID", "WINDOWS"] as const;
export type BuildTarget = (typeof BUILD_TARGETS)[number];

export const BUILD_STATUSES = ["QUEUED", "RUNNING", "SUCCESS", "FAILED", "CANCELED"] as const;
export type BuildStatus = (typeof BUILD_STATUSES)[number];

export const BUILD_TARGET_LABEL: Record<BuildTarget, string> = {
  ANDROID: "Android (APK)",
  WINDOWS: "Windows (установщик)",
};

/** Сколько журнала храним. Хвост важнее начала: ошибка всегда в конце. */
export const LOG_LIMIT = 64 * 1024;

/**
 * Через сколько молчания сборка считается зависшей. Полчаса — это заведомо
 * больше самой долгой честной сборки и заведомо меньше рабочего дня: очередь
 * не должна стоять до утра из-за упавшего агента.
 */
export const STALE_MS = 30 * 60 * 1000;

export function isBuildTarget(value: unknown): value is BuildTarget {
  return typeof value === "string" && (BUILD_TARGETS as readonly string[]).includes(value);
}

export function isBuildStatus(value: unknown): value is BuildStatus {
  return typeof value === "string" && (BUILD_STATUSES as readonly string[]).includes(value);
}

/** Задача закончена: трогать её больше нельзя. */
export function isTerminal(status: string): boolean {
  return status === "SUCCESS" || status === "FAILED" || status === "CANCELED";
}

/**
 * Ветка или коммит.
 *
 * Значение уходит в `git fetch` на сервере, поэтому проверка строгая и
 * разрешающая, а не запрещающая: перечислено то, что можно, всё остальное —
 * отказ. Точка с запятой, пробел или `--upload-pack` в имени ветки не должны
 * иметь ни единого шанса добраться до командной строки.
 */
export function normalizeRef(value: unknown): string | null {
  /* Поля нет вовсе — обычный случай: кнопка «Собрать» ветку не спрашивает.
     Это отличается от «прислали мусор вместо строки», который отклоняется. */
  if (value === undefined) return "main";
  if (typeof value !== "string") return null;
  const ref = value.trim();
  if (!ref) return "main";
  if (ref.length > 100) return null;
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]*$/.test(ref)) return null;
  // «..» в имени ветки — это диапазон ревизий, а не ветка.
  if (ref.includes("..")) return null;
  if (ref.endsWith("/") || ref.endsWith(".lock")) return null;
  return ref;
}

interface JobLike {
  id: string;
  target: string;
  status: string;
  createdAt: Date;
  heartbeatAt?: Date | null;
  startedAt?: Date | null;
}

/**
 * Можно ли поставить ещё одну такую задачу.
 *
 * Вторая задача на ту же цель, пока первая ждёт, ничего не даёт: соберётся то
 * же самое из того же кода. Двойное нажатие кнопки — обычное дело, и оно не
 * должно превращаться в две сборки подряд.
 */
export function queueRefusal(jobs: JobLike[], target: BuildTarget): string | null {
  const queued = jobs.find((job) => job.target === target && job.status === "QUEUED");
  if (queued) return "Такая сборка уже стоит в очереди";
  const running = jobs.find((job) => job.target === target && job.status === "RUNNING");
  if (running) return "Такая сборка уже идёт";
  return null;
}

/**
 * Задачи, которые агент бросил: взял в работу и замолчал.
 *
 * Без этого одна упавшая сборка останавливает очередь навсегда — состояние
 * RUNNING некому снять, а новая задача не начнётся, пока предыдущая «идёт».
 */
export function staleJobs(jobs: JobLike[], now: number, staleMs = STALE_MS): JobLike[] {
  return jobs.filter((job) => {
    if (job.status !== "RUNNING") return false;
    const last = job.heartbeatAt ?? job.startedAt ?? job.createdAt;
    return now - last.getTime() > staleMs;
  });
}

/**
 * Следующая задача для агента или null.
 *
 * null — это не ошибка, а обычный ответ: очередь пуста либо уже что-то идёт.
 * Зависшие задачи в расчёт не берутся — их отдельно закрывает `staleJobs`,
 * иначе они держали бы очередь.
 */
export function nextJob(jobs: JobLike[], now: number, staleMs = STALE_MS): JobLike | null {
  const stale = new Set(staleJobs(jobs, now, staleMs).map((job) => job.id));
  const busy = jobs.some((job) => job.status === "RUNNING" && !stale.has(job.id));
  if (busy) return null;

  return (
    jobs
      .filter((job) => job.status === "QUEUED")
      /* Порядок строго по времени постановки: иначе задача может простоять в
         очереди неограниченно долго, и понять почему будет невозможно. */
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())[0] ?? null
  );
}

/**
 * Дописать кусок журнала, обрезая начало.
 *
 * Обрезается именно начало: конец нужнее — ошибка всегда там. Место обрезки
 * помечается, чтобы «журнал начинается с середины строки» не выглядело сбоем.
 */
export function appendLog(existing: string, chunk: string, limit = LOG_LIMIT): string {
  const merged = `${existing}${chunk}`;
  if (merged.length <= limit) return merged;
  const marker = "…начало журнала обрезано…\n";
  return marker + merged.slice(merged.length - (limit - marker.length));
}

/**
 * Имена файлов, которые агент положил в хранилище загрузок.
 *
 * Разрешён закрытый список расширений — тот же, что умеет раздавать
 * `lib/desktopStore`. Всё остальное отбрасывается молча: имя приходит от агента,
 * а агент — это программа на другой машине, и доверять её словам про пути
 * незачем. Каталоги в имени тоже отбрасываются.
 */
const ARTIFACT_EXT = [".apk", ".exe", ".7z", ".blockmap", ".yml", ".yaml", ".zip", ".dmg", ".appimage", ".deb"];

export function normalizeArtifacts(value: unknown): string[] {
  const list = Array.isArray(value) ? value : typeof value === "string" ? value.split(",") : [];
  const out: string[] = [];
  for (const item of list) {
    if (typeof item !== "string") continue;
    const name = item.trim();
    if (!name || name.length > 120) continue;
    if (name.includes("/") || name.includes("\\") || name.includes("..")) continue;
    if (!/^[A-Za-z0-9][A-Za-z0-9._ -]*$/.test(name)) continue;
    const lower = name.toLowerCase();
    if (!ARTIFACT_EXT.some((ext) => lower.endsWith(ext))) continue;
    if (!out.includes(name)) out.push(name);
  }
  return out.slice(0, 20);
}

/** Версия приложения из отчёта агента: только то, что похоже на версию. */
export function normalizeVersion(value: unknown): string {
  if (typeof value !== "string") return "";
  const version = value.trim().slice(0, 40);
  return /^[A-Za-z0-9][A-Za-z0-9._+-]*$/.test(version) ? version : "";
}

/** Длительность сборки в секундах — для показа в панели. */
export function durationSeconds(job: { startedAt?: Date | null; finishedAt?: Date | null }, now: number): number | null {
  if (!job.startedAt) return null;
  const end = job.finishedAt?.getTime() ?? now;
  return Math.max(0, Math.round((end - job.startedAt.getTime()) / 1000));
}
