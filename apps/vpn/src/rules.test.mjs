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
  isPeerCidr,
  MSS_CHAIN,
  mssCommands,
  mssValue,
  normalizeAllowed,
  parseDump,
  parseInterfaceParams,
  peerChanges,
  policeBurstKb,
  rulesSignature,
  SNAT_CHAIN,
  throttleCommands,
  throttleRules,
  throttleSignature,
} from "./rules.mjs";

/* Публичные ключи WireGuard — 44 символа base64 с «=» на конце. Разбор их
   проверяет, поэтому в тестах нужны настоящие по форме, а не «KEY1»: с
   короткими строками проверялось бы не поведение, а собственная опечатка. */
const KEY1 = `${"A".repeat(43)}=`;
const KEY2 = `${"B".repeat(43)}=`;
const KEY3 = `${"C".repeat(43)}=`;

/** Строка dump: ключ, preshared, endpoint, allowed-ips, рукопожатие, rx, tx, keepalive. */
function dumpLine(publicKey, allowedIps, handshake = "0", rx = "0", tx = "0") {
  return [publicKey, "(none)", "1.2.3.4:51820", allowedIps, handshake, rx, tx, "off"].join("\t");
}

const IFACE_LINE = ["privkey", "pubkey", "51820", "off"].join("\t");

describe("parseDump", () => {
  it("первая строка — сам интерфейс, в пиры не попадает", () => {
    const peers = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32")].join("\n"));
    expect([...peers.keys()]).toEqual([KEY1]);
  });

  it("читает адреса и время рукопожатия", () => {
    const peers = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32", "1750000000")].join("\n"));
    expect(peers.get(KEY1)).toMatchObject({ allowedIps: "10.8.0.2/32", handshakeUnix: 1750000000 });
  });

  /* NETLINK: счётчики трафика — то, из чего главный сервер считает расход.
     Читаются они из тех же строк, поэтому проверяются здесь же: сдвиг колонок
     на одну означал бы, что в расход идёт время рукопожатия. */
  it("читает накопительные счётчики трафика", () => {
    const peers = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32", "0", "4096", "2048")].join("\n"));
    expect(peers.get(KEY1)).toMatchObject({ rxBytes: 4096, txBytes: 2048 });
  });

  it("«(none)» — это пустой список, а не адрес", () => {
    const peers = parseDump([IFACE_LINE, dumpLine(KEY1, "(none)")].join("\n"));
    expect(peers.get(KEY1).allowedIps).toBe("");
  });

  it("рукопожатия не было — ноль", () => {
    const peers = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32", "0")].join("\n"));
    expect(peers.get(KEY1).handshakeUnix).toBe(0);
  });

  it("пустой вывод — пустая карта, а не падение", () => {
    expect(parseDump("").size).toBe(0);
    expect(parseDump(undefined).size).toBe(0);
  });

  it("обрезанные строки пропускаются", () => {
    const peers = parseDump([IFACE_LINE, `${KEY1}\t(none)`, dumpLine(KEY2, "10.8.0.3/32")].join("\n"));
    expect([...peers.keys()]).toEqual([KEY2]);
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
      { publicKey: KEY1, allowedIp: "10.8.0.2/32" },
      { publicKey: "", allowedIp: "10.8.0.3/32" },
      { publicKey: KEY3 },
      { publicKey: "KEY-НЕ-КЛЮЧ", allowedIp: "10.8.0.4/32" },
      null,
      "мусор",
    ]);
    expect(peers).toEqual([{ publicKey: KEY1, allowedIp: "10.8.0.2/32" }]);
  });

  /**
   * ИНВАРИАНТ: потолок скорости доходит до узла. Он приезжает от главного
   * сервера и раньше молча отбрасывался здесь — из-за этого правило «снизить
   * скорость» не исполнялось вовсе, и вышедший за лимит оставался с полной
   * скоростью, то есть с безлимитом по факту.
   */
  it("ИНВАРИАНТ: потолок скорости сохраняется, мусорный отбрасывается", () => {
    const peers = acceptPeers([
      { publicKey: KEY1, allowedIp: "10.8.0.2/32", throttleKbps: 2048 },
      { publicKey: KEY2, allowedIp: "10.8.0.3/32", throttleKbps: 0 },
      { publicKey: KEY3, allowedIp: "10.8.0.4/32", throttleKbps: "быстро" },
    ]);
    expect(peers).toEqual([
      { publicKey: KEY1, allowedIp: "10.8.0.2/32", throttleKbps: 2048 },
      { publicKey: KEY2, allowedIp: "10.8.0.3/32" },
      { publicKey: KEY3, allowedIp: "10.8.0.4/32" },
    ]);
  });

  it("не массив — пустой список", () => {
    expect(acceptPeers(null)).toEqual([]);
    expect(acceptPeers(undefined)).toEqual([]);
  });
});

describe("peerChanges", () => {
  it("нового пира добавляем", () => {
    const changes = peerChanges(new Map(), [{ publicKey: KEY1, allowedIp: "10.8.0.2/32" }]);
    expect(changes.toSet).toEqual([{ publicKey: KEY1, allowedIp: "10.8.0.2/32" }]);
    expect(changes.toRemove).toEqual([]);
    expect(changes.total).toBe(1);
  });

  /**
   * ИНВАРИАНТ: неизменившегося пира не трогаем. Иначе агент каждую минуту
   * переназначал бы всех — работа впустую и лишний шум в логах узла.
   */
  it("ИНВАРИАНТ: совпадающий пир не переназначается", () => {
    const present = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32")].join("\n"));
    const changes = peerChanges(present, [{ publicKey: KEY1, allowedIp: "10.8.0.2/32" }]);
    expect(changes.toSet).toEqual([]);
    expect(changes.toRemove).toEqual([]);
  });

  it("сменился адрес — переназначаем", () => {
    const present = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32")].join("\n"));
    const changes = peerChanges(present, [{ publicKey: KEY1, allowedIp: "10.8.0.9/32" }]);
    expect(changes.toSet).toEqual([{ publicKey: KEY1, allowedIp: "10.8.0.9/32" }]);
  });

  /**
   * ИНВАРИАНТ: пир, которого нет в присланном списке, снимается с интерфейса.
   * На этом держится и отзыв доступа, и выключатель сервиса: главный сервер
   * присылает пустой список, и узел разрывает все туннели сам.
   */
  it("ИНВАРИАНТ: лишний пир снимается", () => {
    const present = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32"), dumpLine(KEY2, "10.8.0.3/32")].join("\n"));
    const changes = peerChanges(present, [{ publicKey: KEY1, allowedIp: "10.8.0.2/32" }]);
    expect(changes.toRemove).toEqual([KEY2]);
  });

  it("пустой список снимает всех", () => {
    const present = parseDump([IFACE_LINE, dumpLine(KEY1, "10.8.0.2/32"), dumpLine(KEY2, "10.8.0.3/32")].join("\n"));
    const changes = peerChanges(present, []);
    expect(changes.toRemove).toEqual([KEY1, KEY2]);
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

describe("FIX-PEERRANGE: служебные адреса подсети нельзя выдать пиру", () => {
  const KEY = `${"A".repeat(43)}=`;

  it("адрес самого узла (.1) отбрасывается", () => {
    /* С таким allowed-ips пир мог бы отвечать за сервер имён всего узла:
       тихая подмена DNS для всех клиентов сразу. */
    expect(isPeerCidr("10.8.0.1/32")).toBe(false);
    expect(acceptPeers([{ publicKey: KEY, allowedIp: "10.8.0.1/32" }])).toHaveLength(0);
  });

  it("адрес сети (.0) и широковещательный (.255) отбрасываются", () => {
    expect(isPeerCidr("10.8.0.0/32")).toBe(false);
    expect(isPeerCidr("10.8.0.255/32")).toBe(false);
  });

  it("границы рабочего диапазона остались рабочими", () => {
    expect(isPeerCidr("10.8.0.2/32")).toBe(true);
    expect(isPeerCidr("10.8.0.254/32")).toBe(true);
  });

  it("чужая подсеть и широкие маршруты отбрасываются", () => {
    expect(isPeerCidr("192.168.1.5/32")).toBe(false);
    expect(isPeerCidr("0.0.0.0/0")).toBe(false);
    expect(isPeerCidr("10.8.0.0/24")).toBe(false);
  });
});

describe("FIX-MSS6: подгонка размера пакета для IPv4 и IPv6", () => {
  it("MSS считается от MTU и зажат в границы", () => {
    expect(mssValue(1420)).toBe(1380);
    expect(mssValue(1280)).toBe(1240);
    expect(mssValue(9000)).toBe(1380);
    expect(mssValue(100)).toBe(536);
    expect(mssValue("мусор")).toBe(1240);
  });

  it("правила есть для обоих протоколов", () => {
    /* Без IPv6-части подгонка работала только для части сайтов. */
    const commands = mssCommands("wg0", 1420);
    expect(commands.some((c) => !c.ipv6)).toBe(true);
    expect(commands.some((c) => c.ipv6)).toBe(true);
  });

  it("для IPv6 запас на 20 байт больше: его заголовок тяжелее", () => {
    const commands = mssCommands("wg0", 1420);
    const value = (ipv6) => {
      const command = commands.find((c) => Boolean(c.ipv6) === ipv6 && c.args.includes("--set-mss"));
      return Number(command.args[command.args.indexOf("--set-mss") + 1]);
    };
    expect(value(false)).toBe(1380);
    expect(value(true)).toBe(1360);
  });

  it("ИНВАРИАНТ: своя цепочка ставится ПЕРВОЙ в FORWARD", () => {
    /* Та же ошибка, что была с SNAT: в конце цепочки правило может не
       сработать вовсе, если раньше есть завершающий переход. */
    for (const ipv6 of [false, true]) {
      const attach = mssCommands("wg0", 1420).find(
        (c) => Boolean(c.ipv6) === ipv6 && c.args.includes("-I"),
      );
      expect(attach.args).toEqual(["-t", "mangle", "-I", "FORWARD", "1", "-j", MSS_CHAIN]);
    }
  });

  it("правила ставятся в обе стороны и только на начало соединения", () => {
    const text = JSON.stringify(mssCommands("wg0", 1420));
    expect(text).toContain('"-o","wg0"');
    expect(text).toContain('"-i","wg0"');
    expect(text).toContain("SYN,RST");
  });

  it("ИНВАРИАНТ: отсутствие IPv6 на узле не валит агент", () => {
    /* На узле без ip6tables любая из этих команд отвалится — и агент ушёл бы
       в бесконечный перезапуск, уводя за собой весь туннель. */
    expect(
      mssCommands("wg0", 1420)
        .filter((c) => c.ipv6)
        .every((c) => c.ignoreError === true),
    ).toBe(true);
  });

  it("старые привязки снимаются, цепочка чистится", () => {
    /* Иначе после нескольких перезапусков одно и то же правило копится в
       FORWARD десятками штук и тратит процессор на каждом пакете. */
    const commands = mssCommands("wg0", 1420);
    expect(commands.some((c) => c.args.includes("-F") && !c.ipv6)).toBe(true);
    expect(commands.some((c) => c.args.includes("-D") && c.repeat === 4)).toBe(true);
  });
});

/* ───────────────────── Потолок скорости (NETLINK-THROTTLE) ───────────────────── */

describe("throttleRules", () => {
  it("берёт только тех, кому назначен потолок", () => {
    const rules = throttleRules([
      { publicKey: KEY1, allowedIp: "10.8.0.5/32", throttleKbps: 2048 },
      { publicKey: KEY2, allowedIp: "10.8.0.3/32" },
      { publicKey: KEY3, allowedIp: "10.8.0.4/32", throttleKbps: 0 },
    ]);
    expect(rules).toEqual([{ src: "10.8.0.5", kbps: 2048 }]);
  });

  /**
   * ИНВАРИАНТ: порядок устойчивый. От него зависит подпись набора, а от подписи —
   * решение «трогать ли `tc`». При неустойчивом порядке узел пересобирал бы
   * очереди на каждом отчёте, то есть каждые пять секунд.
   */
  it("ИНВАРИАНТ: порядок не зависит от порядка пиров в ответе", () => {
    const a = throttleRules([
      { allowedIp: "10.8.0.9/32", throttleKbps: 512 },
      { allowedIp: "10.8.0.2/32", throttleKbps: 1024 },
    ]);
    const b = throttleRules([
      { allowedIp: "10.8.0.2/32", throttleKbps: 1024 },
      { allowedIp: "10.8.0.9/32", throttleKbps: 512 },
    ]);
    expect(throttleSignature(a)).toBe(throttleSignature(b));
  });

  it("не массив и мусор внутри — пустой набор", () => {
    expect(throttleRules(undefined)).toEqual([]);
    expect(throttleRules([null, "мусор", { throttleKbps: 100 }, { allowedIp: "нет адреса", throttleKbps: 100 }])).toEqual([]);
  });

  it("подпись меняется при смене потолка", () => {
    const before = throttleRules([{ allowedIp: "10.8.0.5/32", throttleKbps: 2048 }]);
    const after = throttleRules([{ allowedIp: "10.8.0.5/32", throttleKbps: 512 }]);
    expect(throttleSignature(before)).not.toBe(throttleSignature(after));
  });
});

describe("throttleCommands", () => {
  const line = (command) => command.args.join(" ");

  /**
   * ИНВАРИАНТ: пустой набор СНИМАЕТ формирование, а не ставит «большой потолок».
   * Иначе узел, у которого никого не режут, всё равно гонял бы весь трафик
   * через HTB — и его собственная скорость упиралась бы в наш класс.
   */
  it("ИНВАРИАНТ: пустой набор снимает формирование целиком", () => {
    const commands = throttleCommands("awg0", []);
    expect(commands.map(line)).toEqual([
      "qdisc del dev awg0 root",
      "qdisc del dev awg0 ingress",
    ]);
    expect(commands.every((c) => c.ignoreError)).toBe(true);
  });

  /**
   * ИНВАРИАНТ: режутся ОБЕ стороны. Ограничить только отдачу клиенту значит
   * оставить ему полную скорость на выгрузку — а это тот же трафик и тот же
   * лимит.
   */
  it("ИНВАРИАНТ: и отдача клиенту, и приём от него", () => {
    const lines = throttleCommands("awg0", [{ src: "10.8.0.5", kbps: 2048 }]).map(line);
    expect(lines).toContain(
      "filter add dev awg0 protocol ip parent 1: prio 1 u32 match ip dst 10.8.0.5/32 flowid 1:10",
    );
    expect(lines).toContain(
      "filter add dev awg0 parent ffff: protocol ip prio 1 u32 match ip src 10.8.0.5/32 police rate 2048kbit burst 256k drop flowid :1",
    );
  });

  it("прежний набор снимается перед установкой нового", () => {
    const commands = throttleCommands("awg0", [{ src: "10.8.0.5", kbps: 2048 }]);
    expect(commands.slice(0, 2).map(line)).toEqual([
      "qdisc del dev awg0 root",
      "qdisc del dev awg0 ingress",
    ]);
    /* Снятие может не получиться (набора не было) — это не отказ. А установка
       обязана получиться, иначе лимит не исполняется. */
    expect(commands.slice(2).some((c) => c.ignoreError)).toBe(false);
  });

  it("каждому пиру свой класс и своя честная очередь", () => {
    const lines = throttleCommands("awg0", [
      { src: "10.8.0.2", kbps: 1024 },
      { src: "10.8.0.5", kbps: 2048 },
    ]).map(line);
    expect(lines).toContain("class add dev awg0 parent 1: classid 1:10 htb rate 1024kbit ceil 1024kbit");
    expect(lines).toContain("class add dev awg0 parent 1: classid 1:11 htb rate 2048kbit ceil 2048kbit");
    expect(lines).toContain("qdisc add dev awg0 parent 1:10 handle 10: fq_codel");
    expect(lines).toContain("qdisc add dev awg0 parent 1:11 handle 11: fq_codel");
  });

  it("нерезаный трафик идёт классом по умолчанию", () => {
    const lines = throttleCommands("awg0", [{ src: "10.8.0.5", kbps: 2048 }]).map(line);
    expect(lines).toContain("qdisc add dev awg0 root handle 1: htb default 999");
    expect(lines).toContain("class add dev awg0 parent 1: classid 1:999 htb rate 10gbit");
  });
});

describe("policeBurstKb", () => {
  it("запас — восьмая часть секунды, но не меньше 32 КБ", () => {
    expect(policeBurstKb(2048)).toBe(256);
    expect(policeBurstKb(128)).toBe(32);
  });
});
