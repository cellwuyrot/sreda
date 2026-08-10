#!/usr/bin/env node
/**
 * BUILDS: агент сборки клиентских приложений.
 *
 * Раз в несколько секунд спрашивает у главного сервера, есть ли работа, и если
 * есть — запускает скрипт сборки, пересылая журнал по ходу дела. Готовые файлы
 * кладёт в то же хранилище загрузок, откуда они раздавались раньше: адрес
 * скачивания не меняется, меняется только то, кто эти файлы делает.
 *
 * ── Почему «на вытягивание», как у VPN-узла ──────────────────────────────────
 *
 * Агент сам приходит к серверу, сервер к агенту не обращается никогда. Обычно
 * агент работает на самом главном сервере — открывать ему входящий порт было бы
 * незачем. Но ровно из-за этой модели сборку можно перенести на отдельную
 * машину (в том числе на настоящую Windows) без единой правки кода: переезжает
 * служба, а не логика.
 *
 * ── Почему без зависимостей и без TypeScript ─────────────────────────────────
 *
 * Это системная служба: она должна подниматься одной командой `node` на машине,
 * где может не быть ничего, кроме Node. Каждая зависимость здесь — ещё один
 * способ не собраться в неудачный момент.
 *
 * ── Чего агент НЕ делает ─────────────────────────────────────────────────────
 *
 * Не собирает в рабочем каталоге приложения. Сборка делает `git reset --hard` и
 * перетряхивает node_modules; в каталоге, откуда работает сайт, это означало бы
 * падение сайта посреди сборки. Каталог сборки задаётся отдельно и обязан
 * отличаться от рабочего.
 */

import { spawn } from "child_process";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const HERE = path.dirname(fileURLToPath(import.meta.url));

const MAIN_URL = (process.env.TRIOZ_MAIN_URL || "").replace(/\/+$/, "");
const TOKEN = process.env.TRIOZ_AGENT_TOKEN || "";
/** Отдельный клон репозитория ТОЛЬКО под сборку. */
const REPO_DIR = process.env.TRIOZ_BUILD_REPO || "/var/lib/trioz-build/repo";
/** Куда класть готовые файлы — то же хранилище, что раздаёт /desktop/. */
const ARTIFACT_DIR = process.env.TRIOZ_ARTIFACT_DIR || "/var/www/trioz/apps/web/public/desktop";
const POLL_MS = Number(process.env.TRIOZ_POLL_MS || 10_000);
/** Предел на одну сборку. Дольше — что-то пошло не так, и это уже не сборка. */
const BUILD_TIMEOUT_MS = Number(process.env.TRIOZ_BUILD_TIMEOUT_MS || 40 * 60 * 1000);
/** Как часто отправлять накопленный журнал. */
const LOG_FLUSH_MS = 3000;

if (!MAIN_URL || !TOKEN) {
  console.error("Нужны TRIOZ_MAIN_URL и TRIOZ_AGENT_TOKEN");
  process.exit(1);
}

const SCRIPTS = {
  ANDROID: path.join(HERE, "..", "scripts", "build-android.sh"),
  WINDOWS: path.join(HERE, "..", "scripts", "build-windows.sh"),
};

async function api(pathname, body) {
  const res = await fetch(`${MAIN_URL}${pathname}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
  if (!res.ok) {
    throw new Error(`${pathname}: ${res.status}`);
  }
  return res.json();
}

/**
 * Одна сборка.
 *
 * Скрипт объявляет результат строками в журнале:
 *
 *   TRIOZ_VERSION=0.3.3       — версия собранного приложения
 *   TRIOZ_ARTIFACT=имя.apk    — файл, положенный в хранилище (можно несколько)
 *
 * Разбор по строкам, а не отдельным файлом состояния: журнал всё равно
 * пересылается, и это единственный канал, который точно работает.
 */
async function runJob(job) {
  const script = SCRIPTS[job.target];
  if (!script || !existsSync(script)) {
    await api(`/api/builds/${job.id}`, { status: "FAILED", error: `нет скрипта сборки для ${job.target}` });
    return;
  }

  const artifacts = [];
  let version = "";
  let pending = "";
  let tail = "";
  let canceled = false;

  const child = spawn("bash", [script], {
    env: {
      ...process.env,
      TRIOZ_REF: job.ref,
      TRIOZ_BUILD_REPO: REPO_DIR,
      TRIOZ_ARTIFACT_DIR: ARTIFACT_DIR,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const onChunk = (data) => {
    const text = data.toString();
    pending += text;
    tail = (tail + text).slice(-500);
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (trimmed.startsWith("TRIOZ_VERSION=")) version = trimmed.slice("TRIOZ_VERSION=".length);
      else if (trimmed.startsWith("TRIOZ_ARTIFACT=")) artifacts.push(trimmed.slice("TRIOZ_ARTIFACT=".length));
    }
  };
  child.stdout.on("data", onChunk);
  child.stderr.on("data", onChunk);

  /* Журнал уходит порциями, а не в конце: у сборки, которая идёт десять минут,
     это единственный способ увидеть, что она не встала. Тот же запрос служит
     весточкой «я жив» — без неё через полчаса задача считается брошенной. */
  const flush = setInterval(async () => {
    const chunk = pending;
    pending = "";
    try {
      const answer = await api(`/api/builds/${job.id}`, chunk ? { log: chunk } : {});
      if (answer?.canceled) {
        canceled = true;
        child.kill("SIGTERM");
      }
    } catch {
      /* Сервер недоступен — сборку не бросаем: связь вернётся, а начинать
         заново дороже. Потерянный кусок журнала переживём. */
    }
  }, LOG_FLUSH_MS);

  const timer = setTimeout(() => child.kill("SIGKILL"), BUILD_TIMEOUT_MS);

  const code = await new Promise((resolve) => {
    child.on("error", () => resolve(-1));
    child.on("close", (value) => resolve(value ?? -1));
  });

  clearInterval(flush);
  clearTimeout(timer);

  if (canceled) {
    console.log(`[builder] сборка ${job.id} отменена`);
    return;
  }

  const ok = code === 0;
  await api(`/api/builds/${job.id}`, {
    log: pending,
    status: ok ? "SUCCESS" : "FAILED",
    version,
    artifacts,
    error: ok ? "" : `код выхода ${code}: ${tail.split("\n").filter(Boolean).slice(-1)[0] ?? ""}`.slice(0, 300),
  }).catch((err) => console.error("[builder] не удалось отчитаться:", err.message));

  console.log(`[builder] сборка ${job.id} (${job.target}) — ${ok ? "успех" : "отказ"}`);
}

async function tick() {
  const answer = await api("/api/builds/next");
  if (!answer?.job) return;
  console.log(`[builder] взял сборку ${answer.job.id}: ${answer.job.target} из ${answer.job.ref}`);
  await runJob(answer.job);
}

console.log(`[builder] запущен: ${MAIN_URL}, каталог сборки ${REPO_DIR}, хранилище ${ARTIFACT_DIR}`);

/* Последовательный цикл, а не setInterval: следующий опрос начинается после
   окончания предыдущего. Иначе долгая сборка накопила бы очередь запросов. */
for (;;) {
  try {
    await tick();
  } catch (err) {
    console.error("[builder]", err.message);
  }
  await new Promise((resolve) => setTimeout(resolve, POLL_MS));
}
