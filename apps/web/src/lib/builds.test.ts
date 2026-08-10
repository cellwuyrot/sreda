/**
 * Тесты: src/lib/builds.ts — очередь сборок клиентских приложений.
 *
 * Проверяется то, что ломается тихо и дорого:
 *
 *   • ровно одна сборка за раз — две параллельные кладут машину;
 *   • очередь не встаёт навсегда из-за упавшего агента;
 *   • имя ветки уходит в git на сервере, поэтому проверка разрешающая;
 *   • имена файлов приходят от агента и не должны превращаться в пути.
 */
import { describe, it, expect } from "vitest";
import {
  appendLog,
  durationSeconds,
  isBuildTarget,
  isTerminal,
  nextJob,
  normalizeArtifacts,
  normalizeRef,
  normalizeVersion,
  queueRefusal,
  staleJobs,
} from "@/lib/builds";

const T0 = new Date("2026-08-02T10:00:00Z").getTime();
const at = (offsetMs: number) => new Date(T0 + offsetMs);

function job(over: Partial<Parameters<typeof nextJob>[0][number]> = {}) {
  return {
    id: "j1",
    target: "ANDROID",
    status: "QUEUED",
    createdAt: at(0),
    heartbeatAt: null,
    startedAt: null,
    ...over,
  };
}

describe("BUILDS: что можно ставить в очередь", () => {
  it("цель сборки — только известная", () => {
    expect(isBuildTarget("ANDROID")).toBe(true);
    expect(isBuildTarget("WINDOWS")).toBe(true);
    expect(isBuildTarget("IOS")).toBe(false);
    expect(isBuildTarget("")).toBe(false);
  });

  it("на пустой очереди ставится что угодно", () => {
    expect(queueRefusal([], "ANDROID")).toBeNull();
  });

  it("ФИКСАЦИЯ: вторая такая же задача не ставится — двойное нажатие не даёт двух сборок", () => {
    expect(queueRefusal([job()], "ANDROID")).toMatch(/очереди/);
    expect(queueRefusal([job({ status: "RUNNING" })], "ANDROID")).toMatch(/идёт/);
  });

  it("другая цель ставится, даже когда первая идёт", () => {
    expect(queueRefusal([job({ status: "RUNNING" })], "WINDOWS")).toBeNull();
  });

  it("законченные задачи ставить заново не мешают", () => {
    for (const status of ["SUCCESS", "FAILED", "CANCELED"]) {
      expect(queueRefusal([job({ status })], "ANDROID")).toBeNull();
      expect(isTerminal(status)).toBe(true);
    }
    expect(isTerminal("RUNNING")).toBe(false);
  });
});

describe("BUILDS: какую задачу берёт агент", () => {
  it("пустая очередь — работы нет", () => {
    expect(nextJob([], T0)).toBeNull();
  });

  it("берётся самая давняя из ожидающих", () => {
    const jobs = [
      job({ id: "поздняя", createdAt: at(5_000) }),
      job({ id: "ранняя", createdAt: at(1_000), target: "WINDOWS" }),
    ];
    expect(nextJob(jobs, T0 + 10_000)?.id).toBe("ранняя");
  });

  it("ИНВАРИАНТ: пока одна сборка идёт, вторая не начинается", () => {
    /* Gradle и electron-builder забирают по несколько гигабайт: две сборки на
       машине, обслуживающей людей, — это не «быстрее», а «сайт не отвечает». */
    const jobs = [job({ id: "идёт", status: "RUNNING", startedAt: at(0), heartbeatAt: at(1_000) }), job({ id: "ждёт" })];
    expect(nextJob(jobs, T0 + 2_000)).toBeNull();
  });

  it("ФИКСАЦИЯ: брошенная сборка не держит очередь навсегда", () => {
    const jobs = [
      job({ id: "завис", status: "RUNNING", startedAt: at(0), heartbeatAt: at(0) }),
      job({ id: "ждёт", createdAt: at(1_000) }),
    ];
    const now = T0 + 31 * 60 * 1000;
    expect(staleJobs(jobs, now).map((j) => j.id)).toEqual(["завис"]);
    expect(nextJob(jobs, now)?.id).toBe("ждёт");
  });

  it("живой агент зависшим не считается: весточка сдвигает срок", () => {
    const now = T0 + 31 * 60 * 1000;
    const jobs = [job({ id: "идёт", status: "RUNNING", startedAt: at(0), heartbeatAt: new Date(now - 5_000) })];
    expect(staleJobs(jobs, now)).toEqual([]);
    expect(nextJob(jobs, now)).toBeNull();
  });
});

describe("BUILDS: имя ветки", () => {
  it("пусто — главная ветка", () => {
    expect(normalizeRef("")).toBe("main");
    expect(normalizeRef("   ")).toBe("main");
    // Поля нет вовсе: кнопка «Собрать» ветку не спрашивает.
    expect(normalizeRef(undefined)).toBe("main");
  });

  it("обычные имена проходят", () => {
    expect(normalizeRef("main")).toBe("main");
    expect(normalizeRef("release/1.2.0")).toBe("release/1.2.0");
    expect(normalizeRef("v0.3.3")).toBe("v0.3.3");
    expect(normalizeRef("a1b2c3d4")).toBe("a1b2c3d4");
  });

  it("ИНВАРИАНТ: в имя ветки нельзя вписать команду — оно уходит в git на сервере", () => {
    for (const bad of [
      "main; rm -rf /",
      "main && curl evil.tld",
      "--upload-pack=sh",
      "ветка с пробелом",
      "main\nmain",
      "$(whoami)",
      "`id`",
      "main|tee",
      "a..b",
      "-main",
    ]) {
      expect(normalizeRef(bad), bad).toBeNull();
    }
  });

  it("слишком длинное и не строка — отказ", () => {
    expect(normalizeRef("a".repeat(101))).toBeNull();
    expect(normalizeRef(42)).toBeNull();
    expect(normalizeRef(null)).toBeNull();
  });
});

describe("BUILDS: журнал", () => {
  it("короткий журнал дописывается как есть", () => {
    expect(appendLog("раз\n", "два\n")).toBe("раз\nдва\n");
  });

  it("ФИКСАЦИЯ: обрезается НАЧАЛО — ошибка всегда в конце", () => {
    const out = appendLog("A".repeat(200), "ХВОСТ", 100);
    expect(out.length).toBeLessThanOrEqual(100);
    expect(out.endsWith("ХВОСТ")).toBe(true);
    expect(out).toContain("обрезано");
  });
});

describe("BUILDS: имена собранных файлов", () => {
  it("обычные имена проходят", () => {
    expect(normalizeArtifacts(["connect.apk", "TZ Connect Setup 0.3.3.exe", "latest.yml"])).toEqual([
      "connect.apk",
      "TZ Connect Setup 0.3.3.exe",
      "latest.yml",
    ]);
  });

  it("ИНВАРИАНТ: имя не может быть путём — агент присылает имя, а не место", () => {
    expect(normalizeArtifacts(["../../../etc/passwd", "/etc/shadow", "a/b.apk", "..\\win.exe"])).toEqual([]);
  });

  it("посторонние расширения отбрасываются", () => {
    expect(normalizeArtifacts(["build.sh", "notes.txt", "connect.apk"])).toEqual(["connect.apk"]);
  });

  it("повторы схлопываются, список ограничен", () => {
    expect(normalizeArtifacts(["a.apk", "a.apk"])).toEqual(["a.apk"]);
    expect(normalizeArtifacts(Array.from({ length: 50 }, (_, i) => `f${i}.apk`)).length).toBe(20);
  });

  it("строка через запятую тоже принимается", () => {
    expect(normalizeArtifacts("a.apk, b.exe")).toEqual(["a.apk", "b.exe"]);
  });
});

describe("BUILDS: версия и длительность", () => {
  it("версия принимается только похожая на версию", () => {
    expect(normalizeVersion("0.3.3")).toBe("0.3.3");
    expect(normalizeVersion("1.0.0-beta.2")).toBe("1.0.0-beta.2");
    expect(normalizeVersion("версия; rm")).toBe("");
    expect(normalizeVersion(7)).toBe("");
  });

  it("длительность считается по началу и концу", () => {
    expect(durationSeconds({ startedAt: null }, T0)).toBeNull();
    expect(durationSeconds({ startedAt: at(0), finishedAt: at(90_000) }, T0)).toBe(90);
    // Идущая сборка — от начала до «сейчас».
    expect(durationSeconds({ startedAt: at(0) }, T0 + 30_000)).toBe(30);
  });
});
