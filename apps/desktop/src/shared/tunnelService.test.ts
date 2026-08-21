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
  serviceRequestDir,
  isNonce,
  newNonce,
} from "./tunnelService";

/** Разовое число нужного вида: 32 шестнадцатиричные цифры. */
const NONCE = "0123456789abcdef0123456789abcdef";

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

describe("serviceRequestDir", () => {
  it("держит заявки ОТДЕЛЬНО от состояния", () => {
    /* Разделение каталогов — не косметика: в один пишет любой пользователь
       машины, во втором лежит состояние туннеля и сам профиль. Пока это был
       один каталог, состояние можно было подделать. */
    expect(serviceRequestDir("win32", { ProgramData: "D:\\PD" })).toBe("D:\\PD\\TrioZ\\requests");
    expect(serviceRequestDir("win32", {})).not.toBe(serviceDir("win32", {}));
  });
});

describe("isNonce", () => {
  it("принимает только свой формат", () => {
    expect(isNonce(NONCE)).toBe(true);
    expect(isNonce(newNonce())).toBe(true);
    expect(isNonce("")).toBe(false);
    expect(isNonce("ZZZZ")).toBe(false);
    expect(isNonce(NONCE.slice(0, 31))).toBe(false);
  });

  it("даёт разные значения", () => {
    expect(newNonce()).not.toBe(newNonce());
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
    const request = parseRequest(JSON.stringify({ id: "r-1234", action: "up", config: CONFIG, nonce: NONCE }));
    expect(request?.action).toBe("up");
    expect(request?.config).toContain("[Peer]");
  });

  it("разбирает заявку на снятие без профиля", () => {
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "down", nonce: NONCE }))).toEqual({
      id: "r-1234",
      action: "down",
      config: "",
      nonce: NONCE,
    });
  });

  it("отвергает мусор и посторонние действия", () => {
    expect(parseRequest("не json")).toBeNull();
    expect(parseRequest("[]")).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "exec", nonce: NONCE }))).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "..\\..\\x", action: "down", nonce: NONCE }))).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "up", config: "[Interface]", nonce: NONCE }))).toBeNull();
  });

  it("FIX-SVC-NONCE: без разового числа заявка не заявка", () => {
    /* Каталог заявок открыт на запись всем, поэтому сам факт наличия файла
       ничего не доказывает. Значение знает только тот, кто смог прочитать
       отметку служебного компонента, и оно сгорает после одного раза. */
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "down" }))).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "down", nonce: "" }))).toBeNull();
    expect(parseRequest(JSON.stringify({ id: "r-1234", action: "down", nonce: "../x" }))).toBeNull();
  });

  it("не переносит путь к программе из заявки", () => {
    /* Иначе это прямой подъём прав до SYSTEM для любого местного пользователя. */
    const request = parseRequest(
      JSON.stringify({ id: "r-1234", action: "up", config: CONFIG, nonce: NONCE, client: "C:\\evil.exe" }),
    );
    expect(request).not.toBeNull();
    expect(Object.keys(request as object)).toEqual(["id", "action", "config", "nonce"]);
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
    /* Старый компонент не знает про разовое число — разбор не падает, но значение
       пустое, и приложение честно просит переустановку вместо тихого отказа. */
    expect(parseHeartbeat('{"pid":42,"at":7}')).toEqual({ pid: 42, at: 7, nonce: "" });
    expect(parseHeartbeat(`{"pid":42,"at":7,"nonce":"${NONCE}"}`)?.nonce).toBe(NONCE);
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
    expect(parseRequest(JSON.stringify({ id, action: "down", nonce: NONCE }))?.id).toBe(id);
  });
});
