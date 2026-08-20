import { describe, expect, it } from "vitest";

import {
  AGENT_STALE_MS,
  MAX_CONFIG_LENGTH,
  isAgentAlive,
  isSafeConfigText,
  newRequestId,
  parseHeartbeat,
  parseReport,
  parseRequest,
  parseStatus,
  reportVerdict,
  serviceDir,
} from "./tunnelService";

const CONFIG = [
  "[Interface]",
  "PrivateKey = qK4x9Qb0Yc0Sm2Nn6Xv1Zt8Lp3Rw7Ah5Jd2Fg9Ke0=",
  "Address = 10.8.0.2/24",
  "DNS = 1.1.1.1",
  "",
  "[Peer]",
  "PublicKey = ioDVGhMdUnXjAeht76uzBZKyz/6mHu2NgEOk3EfL52A=",
  "AllowedIPs = 0.0.0.0/0",
  "Endpoint = 95.81.126.242:51820",
  "",
].join("\n");

describe("serviceDir", () => {
  it("использует ProgramData на Windows", () => {
    expect(serviceDir("win32", { ProgramData: "D:\\PD" })).toBe("D:\\PD\\TrioZ\\tunnel");
  });

  it("падает на стандартный путь, если переменной нет", () => {
    expect(serviceDir("win32", {})).toBe("C:\\ProgramData\\TrioZ\\tunnel");
  });
});

describe("isSafeConfigText", () => {
  it("принимает настоящий профиль", () => {
    expect(isSafeConfigText(CONFIG)).toBe(true);
  });

  it("отвергает попытку подставить команду оболочки", () => {
    /* Исполнитель работает от SYSTEM, а заявку может подложить любой пользователь. */
    expect(isSafeConfigText(`${CONFIG}\nDNS = 1.1.1.1 & calc.exe`)).toBe(false);
    expect(isSafeConfigText(`${CONFIG}\nAddress = "10.8.0.2"`)).toBe(false);
    expect(isSafeConfigText(`${CONFIG}\nMTU = 1420; shutdown /r`)).toBe(false);
  });

  it("требует секцию Interface и закрытый ключ", () => {
    expect(isSafeConfigText("[Peer]\nPublicKey = abc=")).toBe(false);
    expect(isSafeConfigText("[Interface]\nAddress = 10.8.0.2/24")).toBe(false);
  });

  it("отвергает пустоту и переросший текст", () => {
    expect(isSafeConfigText("")).toBe(false);
    expect(isSafeConfigText(123)).toBe(false);
    expect(isSafeConfigText(CONFIG + "A".repeat(MAX_CONFIG_LENGTH))).toBe(false);
  });
});

describe("parseRequest", () => {
  it("разбирает заявку на поднятие", () => {
    const request = parseRequest(JSON.stringify({ id: "r-1234", action: "up", config: CONFIG }));
    expect(request?.action).toBe("up");
    expect(request?.config).toContain("[Peer]");
  });

  it("разбирает заявку на снятие без профиля", () => {
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "down" }))).toEqual({
      id: "r-1234",
      action: "down",
      config: "",
    });
  });

  it("отвергает мусор и посторонние действия", () => {
    expect(parseRequest("не json")).toBeNull();
    expect(parseRequest("[]")).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "exec" }))).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "..\\..\\x", action: "down" }))).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "up", config: "[Interface]" }))).toBeNull();
  });

  it("не переносит путь к программе из заявки", () => {
    /* Иначе это прямой подъём прав до SYSTEM для любого местного пользователя. */
    const request = parseRequest(
      JSON.stringify({ id: "r-1234", action: "up", config: CONFIG, client: "C:\\evil.exe" }),
    );
    expect(request).not.toBeNull();
    expect(Object.keys(request as object)).toEqual(["id", "action", "config"]);
  });
});

describe("isAgentAlive", () => {
  const now = 1_700_000_000_000;

  it("видит свежую отметку", () => {
    expect(isAgentAlive({ pid: 10, at: now - 2_000 }, now)).toBe(true);
  });

  it("не верит старой отметке и отсутствию файла", () => {
    expect(isAgentAlive({ pid: 10, at: now - AGENT_STALE_MS - 1 }, now)).toBe(false);
    expect(isAgentAlive(null, now)).toBe(false);
  });

  it("разбирает файл отметки", () => {
    expect(parseHeartbeat('{"pid":42,"at":7}')).toEqual({ pid: 42, at: 7 });
    expect(parseHeartbeat("{}")).toBeNull();
  });
});

describe("parseStatus", () => {
  it("разбирает успешный и ошибочный результат", () => {
    expect(parseStatus('{"id":"r-1234","state":"ok","at":5}')?.state).toBe("ok");
    expect(parseStatus('{"id":"r-1234","state":"error","error":"беда","at":5}')?.error).toBe("беда");
    expect(parseStatus('{"id":"r-1234","state":"weird"}')).toBeNull();
  });
});

describe("reportVerdict", () => {
  const now = 1_700_000_000_000;

  it("свежее рукопожатие — связь есть", () => {
    expect(reportVerdict({ handshake: now / 1000 - 10, at: now }, now, 180)).toBe("fresh");
  });

  it("старое или отсутствующее рукопожатие — тишина", () => {
    expect(reportVerdict({ handshake: now / 1000 - 600, at: now }, now, 180)).toBe("silent");
    expect(reportVerdict({ handshake: 0, at: now }, now, 180)).toBe("silent");
  });

  it("устаревшая или пустая сводка — неизвестно", () => {
    /* Именно здесь раньше рождалось ложное «Соединение активно». */
    expect(reportVerdict(null, now, 180)).toBe("unknown");
    expect(reportVerdict({ handshake: now / 1000, at: now - 60_000 }, now, 180)).toBe("unknown");
  });

  it("разбирает файл сводки", () => {
    expect(parseReport('{"handshake":5,"at":6}')).toEqual({ handshake: 5, at: 6 });
    expect(parseReport('{"handshake":"5"}')).toBeNull();
  });
});

describe("newRequestId", () => {
  it("даёт идентификатор, пригодный для проверки", () => {
    const id = newRequestId(() => 0.5);
    expect(parseRequest(JSON.stringify({ id, action: "down" }))?.id).toBe(id);
  });
});
