/**
 * Тесты чистой логики управления туннелем.
 *
 * Проверяем ровно то, что нельзя проверить глазами и что ломается тихо: выбор
 * стека по профилю, экранирование при повышении прав (пробелы и кавычки в пути)
 * и разбор рукопожатия. Запуск процессов и права ОС здесь не участвуют — их без
 * реальной машины всё равно не проверить.
 */
import { describe, it, expect } from "vitest";
import {
  elevatedInvocation,
  handshakeQuery,
  isObfuscatedConfig,
  parseLatestHandshake,
  tunnelBackendCandidates,
  tunnelDownArgs,
  tunnelUpArgs,
  TUNNEL_NAME,
} from "./vpnPlan";

const PLAIN = [
  "[Interface]",
  "PrivateKey = QOM2s3xS1S4H1H2gP+aBcDeFgHiJkLmNoPqRsTuVwXY=",
  "Address = 10.8.0.7/32",
  "DNS = 1.1.1.1",
  "",
  "[Peer]",
  "PublicKey = HdS1S2H1I5aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456=",
  "Endpoint = vpn1.example.ru:51820",
  "AllowedIPs = 0.0.0.0/0, ::/0",
  "PersistentKeepalive = 25",
].join("\n");

const OBFUSCATED = [
  "[Interface]",
  "Jc = 4",
  "S1 = 30",
  "H1 = 1234567890",
  "PrivateKey = QOM2s3xS1S4H1H2gP+aBcDeFgHiJkLmNoPqRsTuVwXY=",
  "Address = 10.8.0.7/32",
  "DNS = 1.1.1.1",
  "",
  "[Peer]",
  "PublicKey = HdS1S2H1I5aBcDeFgHiJkLmNoPqRsTuVwXyZ0123456=",
  "Endpoint = vpn1.example.ru:51820",
  "AllowedIPs = 0.0.0.0/0, ::/0",
].join("\n");

describe("тип профиля: обычный или обфусцированный", () => {
  it("обычный профиль не считается обфусцированным, хотя S1/H1 мелькают в base64 ключей", () => {
    expect(isObfuscatedConfig(PLAIN)).toBe(false);
  });

  it("профиль с параметрами маскировки в [Interface] распознаётся", () => {
    expect(isObfuscatedConfig(OBFUSCATED)).toBe(true);
  });

  it("ключ маскировки в комментарии не в счёт", () => {
    expect(isObfuscatedConfig("[Interface]\n# S1 = 30\nAddress = 10.8.0.2/32")).toBe(false);
  });
});

describe("выбор бинарника под платформу и тип профиля", () => {
  it("Windows, обычный — служба WireGuard", () => {
    expect(tunnelBackendCandidates("win32", false)).toEqual([{ exe: "wireguard.exe", backend: "wireguard" }]);
  });

  it("Windows, обфусцированный — AmneziaWG без отката на обычный", () => {
    expect(tunnelBackendCandidates("win32", true)).toEqual([{ exe: "amneziawg.exe", backend: "amneziawg" }]);
  });

  it("Linux, обычный — wg-quick", () => {
    expect(tunnelBackendCandidates("linux", false)).toEqual([{ exe: "wg-quick", backend: "wireguard" }]);
  });

  it("Linux, обфусцированный — awg-quick", () => {
    expect(tunnelBackendCandidates("linux", true)).toEqual([{ exe: "awg-quick", backend: "amneziawg" }]);
  });
});

describe("аргументы up/down", () => {
  it("Windows ставит службу из файла, снимает по имени туннеля", () => {
    expect(tunnelUpArgs("win32", "C:\\Temp\\trioz.conf")).toEqual(["/installtunnelservice", "C:\\Temp\\trioz.conf"]);
    expect(tunnelDownArgs("win32", "C:\\Temp\\trioz.conf")).toEqual(["/uninstalltunnelservice", TUNNEL_NAME]);
  });

  it("POSIX поднимает и снимает по одному и тому же профилю", () => {
    expect(tunnelUpArgs("linux", "/tmp/x/trioz.conf")).toEqual(["up", "/tmp/x/trioz.conf"]);
    expect(tunnelDownArgs("linux", "/tmp/x/trioz.conf")).toEqual(["down", "/tmp/x/trioz.conf"]);
  });
});

describe("повышение прав: файл и аргументы для spawn без shell", () => {
  it("Linux — pkexec с прямым argv, без кавычек", () => {
    const inv = elevatedInvocation("linux", "/usr/bin/wg-quick", ["up", "/tmp/a b/trioz.conf"]);
    expect(inv.file).toBe("pkexec");
    expect(inv.args).toEqual(["/usr/bin/wg-quick", "up", "/tmp/a b/trioz.conf"]);
  });

  it("Windows — путь с пробелом и одинарной кавычкой экранируется удвоением", () => {
    const inv = elevatedInvocation("win32", "C:\\Program Files\\WireGuard\\wireguard.exe", [
      "/installtunnelservice",
      "C:\\Temp\\o'brien\\trioz.conf",
    ]);
    expect(inv.file).toBe("powershell.exe");
    const script = inv.args[inv.args.length - 1];
    // Путь бинарника — в одинарных кавычках.
    expect(script).toContain("Start-Process -FilePath 'C:\\Program Files\\WireGuard\\wireguard.exe'");
    // Одинарная кавычка в пути профиля удвоена (o''brien), пробелов-ловушек нет.
    expect(script).toContain("'C:\\Temp\\o''brien\\trioz.conf'");
    expect(script).toContain("-Verb RunAs");
    expect(script).toContain("exit $p.ExitCode");
  });

  it("macOS — команда уходит в osascript как административная", () => {
    const inv = elevatedInvocation("darwin", "/opt/homebrew/bin/wg-quick", ["up", "/tmp/a b/trioz.conf"]);
    expect(inv.file).toBe("osascript");
    expect(inv.args[0]).toBe("-e");
    const script = inv.args[1];
    expect(script).toContain("with administrator privileges");
    // Аргументы обёрнуты в одинарные кавычки внутри shell-строки.
    expect(script).toContain("'up'");
    expect(script).toContain("'/tmp/a b/trioz.conf'");
  });
});

describe("разбор рукопожатия для статуса", () => {
  it("берётся самое свежее время среди пиров", () => {
    const out = "abc\t1700000000\ndef\t1700000123\n";
    expect(parseLatestHandshake(out)).toBe(1700000123);
  });

  it("ноль означает «рукопожатия ещё не было»", () => {
    expect(parseLatestHandshake("abc\t0\n")).toBe(0);
    expect(parseLatestHandshake("")).toBe(0);
    expect(parseLatestHandshake("мусор")).toBe(0);
  });

  it("запрос статуса выбирает wg или awg под бэкенд и платформу", () => {
    expect(handshakeQuery("linux", "wireguard").exe).toBe("wg");
    expect(handshakeQuery("linux", "amneziawg").exe).toBe("awg");
    expect(handshakeQuery("win32", "wireguard").exe).toBe("wg.exe");
    expect(handshakeQuery("win32", "wireguard").args).toEqual(["show", TUNNEL_NAME, "latest-handshakes"]);
  });
});
