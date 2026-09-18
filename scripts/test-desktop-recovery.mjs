// node --test scripts/test-desktop-recovery.mjs (после npm ci в монорепозитории)
// Тестируется реальный recovery.ts; Electron заменён управляемым стендом.
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";
import fs from "node:fs";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(resolve(root, "apps/desktop/package.json"));
const ts = require("typescript");
const source = fs.readFileSync(resolve(root, "apps/desktop/src/main/recovery.ts"), "utf8");
const code = ts.transpileModule(source, { compilerOptions: {
  target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true,
} }).outputText;
const pump = async () => { for (let i = 0; i < 30; i++) await Promise.resolve(); };

class Clock {
  now = 1_000;
  next = 1;
  jobs = new Map();
  add(fn, ms, repeat = false) { const id = this.next++; this.jobs.set(id, { fn, at: this.now + ms, ms, repeat }); return id; }
  async tick(ms) {
    const until = this.now + ms;
    await pump();
    for (let n = 0; n < 5000; n++) {
      const next = [...this.jobs.entries()].filter(([, j]) => j.at <= until).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) { this.now = until; await pump(); return; }
      const [id, job] = next;
      this.now = job.at;
      if (job.repeat) job.at += job.ms; else this.jobs.delete(id);
      job.fn();
      await pump();
    }
    throw new Error("timer loop");
  }
}
function setup() {
  const clock = new Clock();
  const counts = { load: 0, fallback: 0, clear: 0, codeClear: 0, probes: 0 };
  const handlers = {};
  const requests = {};
  const settings = { cacheAppVersion: "1.1.6" };
  let health = true, destroyed = false, crashed = false, appUrl = "https://trioz.ru/connect", clearFails = false;
  const session = {
    clearCache: async () => { counts.clear++; if (clearFails) throw new Error("disk"); },
    clearCodeCaches: async () => { counts.codeClear++; },
    webRequest: {
      onBeforeSendHeaders: (filter, callback) => { requests.headers = callback ?? null; },
      onCompleted: (filter, callback) => { requests.completed = callback ?? null; },
    },
  };
  const wc = Object.assign(new EventEmitter(), {
    id: 7, session, mainFrame: { url: appUrl }, url: appUrl,
    getURL() { return this.url; }, isDestroyed: () => destroyed,
    isCrashed: () => crashed, isLoadingMainFrame: () => false,
    executeJavaScript: async () => {
      counts.probes++;
      if (health === "reject") throw new Error("renderer unavailable");
      if (health === "hang") return new Promise(() => {});
      return health;
    },
  });
  const win = Object.assign(new EventEmitter(), {
    webContents: wc, isDestroyed: () => destroyed,
    loadURL: async (url) => {
      counts.load++; crashed = false; wc.url = url; wc.mainFrame.url = url;
      wc.emit("did-start-loading"); wc.emit("did-navigate", {}, url, 200); wc.emit("did-finish-load");
    },
    loadFile: async (file) => {
      counts.fallback++; wc.url = "file://" + file; wc.mainFrame.url = wc.url;
      wc.emit("did-start-loading"); wc.emit("did-finish-load");
    },
  });
  const power = new EventEmitter();
  const electron = {
    app: { getVersion: () => "1.1.7" }, session: { defaultSession: session }, powerMonitor: power,
    ipcMain: { handle: (name, handler) => { handlers[name] = handler; } },
  };
  class Store { get(k) { return settings[k]; } set(k, v) { settings[k] = v; } }
  const mod = { exports: {} };
  const context = {
    module: mod, exports: mod.exports,
    require: (name) => name === "electron" ? electron : name === "electron-store" ? Store : name === "../shared/constants" ? { IPC: { RECOVER_WINDOW: "desktop:recovery-request" } } : require(name),
    __dirname: resolve(root, "apps/desktop/dist/main"),
    console: { warn() {}, error() {}, log() {} },
    Date: { now: () => clock.now },
    setTimeout: (fn, ms) => clock.add(fn, ms), clearTimeout: (id) => clock.jobs.delete(id),
    setInterval: (fn, ms) => clock.add(fn, ms, true), clearInterval: (id) => clock.jobs.delete(id), URL,
  };
  vm.runInNewContext(code, context);
  const api = mod.exports;
  api.installRecovery(win, { getStartUrl: () => appUrl, beforeRecovery() {} });
  return {
    api, clock, counts, win, wc, power, requests, handlers, settings,
    health: (v) => { health = v; }, clearFails: (v) => { clearFails = v; },
    appUrl: (v) => { appUrl = v; },
    close: () => { destroyed = true; win.emit("closed"); },
    crash: () => { crashed = true; wc.emit("render-process-gone", {}, { reason: "crashed", exitCode: 1 }); },
    stale: () => requests.completed({ webContentsId: wc.id, statusCode: 404, url: appUrl.replace(/\/connect$/, "/_next/static/chunks/old.js") }),
  };
}

test("параллельные ошибки объединяются до подтверждения UI", async () => {
  const t = setup();
  t.stale(); t.stale(); t.stale();
  await pump();
  assert.equal(t.counts.load, 1);
  assert.equal(t.counts.clear, 1);
  assert.equal(t.api.recoveryOwnsNavigation(t.win), true);
  await t.clock.tick(3_000);
  assert.equal(t.api.recoveryOwnsNavigation(t.win), false);
  t.api.stopRecovery();
});

test("HTTP 200 не сбрасывает лимит; после двух неудач локальный экран", async () => {
  const t = setup(); t.health(false); t.stale();
  await t.clock.tick(35_000);
  assert.equal(t.counts.load, 2);
  assert.equal(t.counts.fallback, 1);
  t.stale(); await t.clock.tick(120_000);
  assert.equal(t.counts.load, 2);
  t.api.stopRecovery();
});

test("ручное восстановление обходит исчерпанный бюджет и покидает локальный файл", async () => {
  const t = setup(); t.health(false); t.stale(); await t.clock.tick(35_000);
  t.health(true);
  const done = t.api.clearCacheAndReload(t.win, "manual", { manual: true });
  await t.clock.tick(3_000); await done;
  assert.equal(t.counts.load, 3);
  assert.equal(t.wc.getURL(), "https://trioz.ru/connect");
  t.api.stopRecovery();
});

test("звонок откладывает автоматическое восстановление и очистку", async () => {
  const t = setup(); t.api.setVoiceActive(true); t.stale(); await pump();
  assert.equal(t.counts.load, 0); assert.equal(t.counts.clear, 0);
  t.api.setVoiceActive(false); await t.clock.tick(3_000);
  assert.equal(t.counts.load, 1); assert.equal(t.counts.clear, 1);
  t.api.stopRecovery();
});

test("потерянный voice=false не блокирует восстановление после TTL", async () => {
  const t = setup(); t.api.setVoiceActive(true); t.stale();
  await t.clock.tick(9_000); assert.equal(t.counts.load, 0);
  await t.clock.tick(3_000); assert.equal(t.counts.load, 1);
  await t.clock.tick(3_000); t.api.stopRecovery();
});

test("ручной путь доступен и во время звонка", async () => {
  const t = setup(); t.api.setVoiceActive(true);
  const done = t.api.clearCacheAndReload(t.win, "manual", { manual: true });
  await t.clock.tick(3_000); await done;
  assert.equal(t.counts.load, 1); t.api.stopRecovery();
});

test("сетевая ошибка во время звонка ждёт его конца без очистки кеша", async () => {
  const t = setup(); t.api.setVoiceActive(true); void t.api.recoverWindow(t.win, "network");
  await pump(); assert.equal(t.counts.load, 0);
  t.api.setVoiceActive(false); await t.clock.tick(3_000);
  assert.equal(t.counts.load, 1); assert.equal(t.counts.clear, 0); t.api.stopRecovery();
});

test("плановый осмотр не удаляет кеш здорового окна", async () => {
  const t = setup(); await t.clock.tick(16 * 60_000);
  assert.ok(t.counts.probes > 0);
  assert.equal(t.counts.clear, 0); assert.equal(t.counts.load, 0);
  t.api.stopRecovery();
});

test("отказ JS не считается здоровьем и приводит к ограниченному восстановлению", async () => {
  const t = setup(); t.health("reject"); t.win.emit("focus");
  await t.clock.tick(45_000);
  assert.equal(t.counts.load, 2); assert.equal(t.counts.fallback, 1);
  assert.equal(t.counts.clear, 0);
  t.api.stopRecovery();
});

test("зависший JS ограничен таймаутом; после сна выполняется проверка", async () => {
  const t = setup(); t.health("hang"); t.power.emit("resume");
  await t.clock.tick(100_000);
  assert.equal(t.counts.load, 2); assert.equal(t.counts.fallback, 1);
  t.api.stopRecovery();
});

test("падение renderer восстанавливается без бесполезной очистки кеша", async () => {
  const t = setup(); t.crash(); await t.clock.tick(3_000);
  assert.equal(t.counts.load, 1); assert.equal(t.counts.clear, 0);
  t.api.stopRecovery();
});

test("закрытие окна снимает подписки и не запускает новые перезагрузки", async () => {
  const t = setup(); t.close(); t.power.emit("resume"); await t.clock.tick(120_000);
  assert.equal(t.counts.load, 0); assert.equal(t.requests.completed, null);
  assert.equal(t.power.listenerCount("resume"), 0);
});

test("IPC отклоняет чужое окно, iframe и сторонний origin", async () => {
  const t = setup(), handler = t.handlers[t.api.RECOVERY_REQUEST];
  assert.equal(handler({ sender: {}, senderFrame: {} }), false);
  assert.equal(handler({ sender: t.wc, senderFrame: { url: t.wc.url } }), false);
  t.wc.mainFrame.url = "https://evil.example";
  assert.equal(handler({ sender: t.wc, senderFrame: t.wc.mainFrame }), false);
  assert.equal(t.counts.load, 0);
  t.api.stopRecovery();
});

test("webRequest учитывает новый origin и игнорирует запрос другого окна", async () => {
  const t = setup(); t.appUrl("https://new.example/connect");
  t.requests.completed({ webContentsId: 8, statusCode: 404, url: "https://new.example/_next/static/old.js" });
  await pump(); assert.equal(t.counts.load, 0);
  let headers;
  t.requests.headers({ webContentsId: 7, resourceType: "mainFrame", url: "https://new.example/connect", requestHeaders: {} }, (r) => { headers = r.requestHeaders; });
  assert.equal(headers["Cache-Control"], "no-cache");
  t.stale(); await t.clock.tick(3_000); assert.equal(t.counts.load, 1);
  t.api.stopRecovery();
});

test("версия кеша записывается только после успешной очистки", async () => {
  const t = setup(); t.clearFails(true); await t.api.invalidateCacheOnVersionChange();
  assert.equal(t.settings.cacheAppVersion, "1.1.6");
  t.clearFails(false); await t.api.invalidateCacheOnVersionChange();
  assert.equal(t.settings.cacheAppVersion, "1.1.7");
  t.api.stopRecovery();
});
