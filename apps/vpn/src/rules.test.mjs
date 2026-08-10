/**
 * Тесты агента VPN-узла: разбор вывода WireGuard и построение команд iptables.
 *
 * Зачем они появились. Закрепление внешних адресов не работало ни на одном узле,
 * настроенном по README: агент вешал свою цепочку в POSTROUTING «в конец», а
 * MASQUERADE из `wg0.conf` стоит там раньше и завершает обход таблицы `nat` —
 * до нашей цепочки пакет просто не доходил. Проверено счётчиками пакетов в
 * сетевом пространстве имён: у MASQUERADE 1 пакет, у TRIOZ_VPN_SNAT 0.
 *
 * Поймать это можно только на порядке команд, поэтому порядок и проверяется.
 */
import { describe, it, expect } from "vitest";
import {
  acceptPeers,
  chainAttachCommands,
  chainFillCommands,
  exitRules,
  normalizeAllowed,
  parseDump,
  parseInterfaceParams,
  peerChanges,
  rulesSignature,
  SNAT_CHAIN,
} from "./rules.mjs";

/** Строка dump: ключ, preshared, endpoint, allowed-ips, рукопожатие, rx, tx, keepalive. */
function dumpLine(publicKey, allowedIps, handshake = "0") {
  return [publicKey, "(none)", "1.2.3.4:51820", allowedIps, handshake, "0", "0", "off"].join("\t");
}

const IFACE_LINE = ["privkey", "pubkey", "51820", "off"].join("\t");

describe("parseDump", () => {
  it("первая строка — сам интерфейс, в пиры не попадает", () => {
    const peers = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32")].join("\n"));
    expect([...peers.keys()]).toEqual(["KEY1"]);
  });

  it("читает адреса и время рукопожатия", () => {
    const peers = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32", "1750000000")].join("\n"));
    expect(peers.get("KEY1")).toEqual({ allowedIps: "10.8.0.2/32", handshakeUnix: 1750000000 });
  });

  it("«(none)» — это пустой список, а не адрес", () => {
    const peers = parseDump([IFACE_LINE, dumpLine("KEY1", "(none)")].join("\n"));
    expect(peers.get("KEY1").allowedIps).toBe("");
  });

  it("рукопожатия не было — ноль", () => {
    const peers = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32", "0")].join("\n"));
    expect(peers.get("KEY1").handshakeUnix).toBe(0);
  });

  it("пустой вывод — пустая карта, а не падение", () => {
    expect(parseDump("").size).toBe(0);
    expect(parseDump(undefined).size).toBe(0);
  });

  it("обрезанные строки пропускаются", () => {
    const peers = parseDump([IFACE_LINE, "KEY1\t(none)", dumpLine("KEY2", "10.8.0.3/32")].join("\n"));
    expect([...peers.keys()]).toEqual(["KEY2"]);
  });
});

describe("normalizeAllowed", () => {
  it("список приводится к сравнимому виду", () => {
    expect(normalizeAllowed("10.8.0.2/32, 10.8.0.3/32")).toBe("10.8.0.2/32,10.8.0.3/32");
  });

  it("пустые значения дают пустую строку", () => {
    expect(normalizeAllowed("(none)")).toBe("");
    expect(normalizeAllowed("")).toBe("");
    expect(normalizeAllowed(null)).toBe("");
  });
});

describe("parseInterfaceParams", () => {
  const keys = new Set(["Jc", "S1", "H1", "I1"]);

  it("берёт только секцию [Interface]", () => {
    const text = ["[Interface]", "Jc = 4", "", "[Peer]", "S1 = 9"].join("\n");
    expect(parseInterfaceParams(text, keys)).toEqual({ Jc: 4 });
  });

  it("числа становятся числами, остальное остаётся строкой", () => {
    const text = ["[Interface]", "S1 = 15", "I1 = <b 0xf00>"].join("\n");
    expect(parseInterfaceParams(text, keys)).toEqual({ S1: 15, I1: "<b 0xf00>" });
  });

  it("комментарии, посторонние ключи и пустые значения не проходят", () => {
    const text = ["[Interface]", "# Jc = 9", "PrivateKey = secret", "H1 =", "Address = 10.8.0.1/24"].join("\n");
    expect(parseInterfaceParams(text, keys)).toEqual({});
  });

  /**
   * ИНВАРИАНТ: приватный ключ узла в разбор не попадает ни при каком составе
   * конфига. Он не нужен агенту и не должен даже оказаться в памяти процесса.
   */
  it("ИНВАРИАНТ: PrivateKey не попадает в результат", () => {
    const text = ["[Interface]", "PrivateKey = OYUuu2vHF+ppp0000000000000000000000000000000=", "Jc = 3"].join("\n");
    const params = parseInterfaceParams(text, keys);
    expect(params.PrivateKey).toBeUndefined();
    expect(JSON.stringify(params)).not.toContain("OYUuu");
  });

  it("нет файла — пустой набор", () => {
    expect(parseInterfaceParams("", keys)).toEqual({});
  });
});

describe("acceptPeers", () => {
  it("оставляет только пиров с ключом и адресом", () => {
    const peers = acceptPeers([
      { publicKey: "KEY1", allowedIp: "10.8.0.2/32" },
      { publicKey: "", allowedIp: "10.8.0.3/32" },
      { publicKey: "KEY3" },
      null,
      "мусор",
    ]);
    expect(peers).toEqual([{ publicKey: "KEY1", allowedIp: "10.8.0.2/32" }]);
  });

  it("не массив — пустой список", () => {
    expect(acceptPeers(null)).toEqual([]);
    expect(acceptPeers(undefined)).toEqual([]);
  });
});

describe("peerChanges", () => {
  it("нового пира добавляем", () => {
    const changes = peerChanges(new Map(), [{ publicKey: "KEY1", allowedIp: "10.8.0.2/32" }]);
    expect(changes.toSet).toEqual([{ publicKey: "KEY1", allowedIp: "10.8.0.2/32" }]);
    expect(changes.toRemove).toEqual([]);
    expect(changes.total).toBe(1);
  });

  /**
   * ИНВАРИАНТ: неизменившегося пира не трогаем. Иначе агент каждую минуту
   * переназначал бы всех — работа впустую и лишний шум в логах узла.
   */
  it("ИНВАРИАНТ: совпадающий пир не переназначается", () => {
    const present = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32")].join("\n"));
    const changes = peerChanges(present, [{ publicKey: "KEY1", allowedIp: "10.8.0.2/32" }]);
    expect(changes.toSet).toEqual([]);
    expect(changes.toRemove).toEqual([]);
  });

  it("сменился адрес — переназначаем", () => {
    const present = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32")].join("\n"));
    const changes = peerChanges(present, [{ publicKey: "KEY1", allowedIp: "10.8.0.9/32" }]);
    expect(changes.toSet).toEqual([{ publicKey: "KEY1", allowedIp: "10.8.0.9/32" }]);
  });

  /**
   * ИНВАРИАНТ: пир, которого нет в присланном списке, снимается с интерфейса.
   * На этом держится и отзыв доступа, и выключатель сервиса: главный сервер
   * присылает пустой список, и узел разрывает все туннели сам.
   */
  it("ИНВАРИАНТ: лишний пир снимается", () => {
    const present = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32"), dumpLine("KEY2", "10.8.0.3/32")].join("\n"));
    const changes = peerChanges(present, [{ publicKey: "KEY1", allowedIp: "10.8.0.2/32" }]);
    expect(changes.toRemove).toEqual(["KEY2"]);
  });

  it("пустой список снимает всех", () => {
    const present = parseDump([IFACE_LINE, dumpLine("KEY1", "10.8.0.2/32"), dumpLine("KEY2", "10.8.0.3/32")].join("\n"));
    const changes = peerChanges(present, []);
    expect(changes.toRemove).toEqual(["KEY1", "KEY2"]);
    expect(changes.total).toBe(0);
  });
});

describe("exitRules", () => {
  it("адрес пира берётся без маски", () => {
    expect(exitRules([{ allowedIp: "10.8.0.2/32", exitIp: "203.0.113.7" }])).toEqual([
      { src: "10.8.0.2", exitIp: "203.0.113.7" },
    ]);
  });

  it("пир без закреплённого адреса правил не получает", () => {
    expect(exitRules([{ allowedIp: "10.8.0.2/32", exitIp: "" }])).toEqual([]);
  });

  it("порядок устойчив: подпись не дёргается от порядка ответа", () => {
    const a = exitRules([
      { allowedIp: "10.8.0.3/32", exitIp: "203.0.113.8" },
      { allowedIp: "10.8.0.2/32", exitIp: "203.0.113.7" },
    ]);
    const b = exitRules([
      { allowedIp: "10.8.0.2/32", exitIp: "203.0.113.7" },
      { allowedIp: "10.8.0.3/32", exitIp: "203.0.113.8" },
    ]);
    expect(rulesSignature(a)).toBe(rulesSignature(b));
  });

  it("пустой набор — пустая подпись", () => {
    expect(rulesSignature([])).toBe("");
  });
});

describe("chainAttachCommands", () => {
  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: цепочка обязана стоять ПЕРВЫМ правилом
   * POSTROUTING. MASQUERADE из `wg0.conf` появляется раньше агента и завершает
   * обход таблицы `nat`; вставка «в конец» означала, что закрепление внешних
   * адресов не срабатывало ни разу.
   */
  it("ИНВАРИАНТ: ссылка вставляется первым правилом, а не добавляется в конец", () => {
    const commands = chainAttachCommands();
    const attach = commands[commands.length - 1];
    expect(attach.args).toEqual(["-t", "nat", "-I", "POSTROUTING", "1", "-j", SNAT_CHAIN]);
    expect(attach.ignoreError).toBeFalsy();
  });

  it("ИНВАРИАНТ: ни одна команда не добавляет ссылку в конец POSTROUTING", () => {
    for (const command of chainAttachCommands()) {
      const line = command.args.join(" ");
      expect(line).not.toContain("-A POSTROUTING");
    }
  });

  /**
   * ИНВАРИАНТ: прежние ссылки снимаются до вставки. На узле, обновившемся со
   * старой версии, ссылка уже висит в конце — проверка «есть ли она» оставила бы
   * неверный порядок навсегда, то есть починка не доехала бы до работающих узлов.
   */
  it("ИНВАРИАНТ: прежние ссылки снимаются до вставки, с запасом на дубли", () => {
    const commands = chainAttachCommands();
    const del = commands.findIndex((c) => c.args.includes("-D"));
    const insert = commands.findIndex((c) => c.args.includes("-I"));
    expect(del).toBeGreaterThanOrEqual(0);
    expect(del).toBeLessThan(insert);
    expect(commands[del].repeat).toBeGreaterThan(1);
    expect(commands[del].ignoreError).toBe(true);
  });

  it("создание цепочки может не получиться — она уже есть", () => {
    const create = chainAttachCommands().find((c) => c.args.includes("-N"));
    expect(create.args).toEqual(["-t", "nat", "-N", SNAT_CHAIN]);
    expect(create.ignoreError).toBe(true);
  });
});

describe("chainFillCommands", () => {
  /**
   * ИНВАРИАНТ: своя цепочка очищается целиком перед наполнением. Так снятые
   * закрепления действительно исчезают, а чужие правила в POSTROUTING остаются
   * нетронутыми — ради этого цепочка и отдельная.
   */
  it("ИНВАРИАНТ: сначала очистка своей цепочки, потом правила", () => {
    const commands = chainFillCommands([{ src: "10.8.0.2", exitIp: "203.0.113.7" }]);
    expect(commands[0].args).toEqual(["-t", "nat", "-F", SNAT_CHAIN]);
    expect(commands[1].args).toEqual([
      "-t", "nat", "-A", SNAT_CHAIN,
      "-s", "10.8.0.2",
      "-j", "SNAT", "--to-source", "203.0.113.7",
    ]);
  });

  it("нет закреплений — только очистка", () => {
    expect(chainFillCommands([])).toHaveLength(1);
  });

  it("ИНВАРИАНТ: очистка идёт по своей цепочке, а не по POSTROUTING", () => {
    for (const command of chainFillCommands([{ src: "10.8.0.2", exitIp: "203.0.113.7" }])) {
      expect(command.args.join(" ")).not.toContain("POSTROUTING");
    }
  });
});
