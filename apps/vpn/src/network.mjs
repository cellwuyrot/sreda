/** Local IPv4 configuration health, NOT an end-to-end Internet probe.
 * Only explicit --repair / WG_NETWORK_REPAIR=1 permits mutations.
 * Never flush tables, touch Docker chains, read keys, or send raw command errors.
 */
export const HEALTH_INTERVAL_MS = 30_000;
export function validInterface(value) {
  return (
    typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,14}$/.test(value)
  );
}
export function networkCidr(address, prefix) {
  if (
    typeof address !== "string" ||
    !/^\d{1,3}(\.\d{1,3}){3}$/.test(address) ||
    !Number.isInteger(prefix) ||
    prefix < 1 ||
    prefix > 30
  )
    return null;
  const octets = address.split(".").map(Number);
  if (octets.some((x) => x > 255) || octets[0] === 0 || octets[0] >= 224)
    return null;
  const value = octets.reduce((acc, x) => ((acc << 8) | x) >>> 0, 0);
  const net = (value & (0xffffffff << (32 - prefix))) >>> 0;
  return [24, 16, 8, 0].map((n) => (net >>> n) & 255).join(".") + "/" + prefix;
}
export function chooseEgress(routes, iface, explicit = "") {
  if (explicit)
    return validInterface(explicit) && explicit !== iface ? explicit : null;
  const usable = routes.filter(
    (r) =>
      r &&
      validInterface(r.dev) &&
      r.dev !== iface &&
      !r.nexthops &&
      (!r.type || r.type === "unicast") &&
      (!r.dst || r.dst === "default"),
  );
  const metric = Math.min(...usable.map((r) => Number(r.metric) || 0));
  const devices = [
    ...new Set(
      usable
        .filter((r) => (Number(r.metric) || 0) === metric)
        .map((r) => r.dev),
    ),
  ];
  return devices.length === 1 ? devices[0] : null;
}
export function networkRules({ iface, egress, subnet, port }) {
  if (
    !validInterface(iface) ||
    !validInterface(egress) ||
    iface === egress ||
    !subnet ||
    networkCidr(...[subnet.split("/")[0], Number(subnet.split("/")[1])]) !==
      subnet ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  )
    throw Error("Invalid VPN network configuration");
  const rule = (name, table, chain, args, legacy = null) => ({
    name,
    table,
    chain,
    args,
    legacy,
    tagged: [
      ...args.slice(0, -2),
      "-m",
      "comment",
      "--comment",
      `trioz-vpn:${iface}:${name}`,
      ...args.slice(-2),
    ],
  });
  return [
    // Append generic NAT: never shadow per-peer TRIOZ_VPN_SNAT at chain head.
    rule("vpnNat", "nat", "POSTROUTING", [
      "-s",
      subnet,
      "-o",
      egress,
      "-j",
      "MASQUERADE",
    ]),
    rule(
      "vpnForwardOut",
      "filter",
      "FORWARD",
      ["-i", iface, "-o", egress, "-s", subnet, "-j", "ACCEPT"],
      ["-i", iface, "-o", egress, "-j", "ACCEPT"],
    ),
    rule(
      "vpnForwardIn",
      "filter",
      "FORWARD",
      [
        "-i",
        egress,
        "-o",
        iface,
        "-d",
        subnet,
        "-m",
        "conntrack",
        "--ctstate",
        "RELATED,ESTABLISHED",
        "-j",
        "ACCEPT",
      ],
      [
        "-i",
        egress,
        "-o",
        iface,
        "-m",
        "conntrack",
        "--ctstate",
        "RELATED,ESTABLISHED",
        "-j",
        "ACCEPT",
      ],
    ),
    rule("vpnUdp", "filter", "INPUT", [
      "-p",
      "udp",
      "--dport",
      String(port),
      "-j",
      "ACCEPT",
    ]),
  ];
}
async function invoke(run, file, args) {
  try {
    const result = await run(file, args);
    return { ok: true, text: result.stdout.trim() };
  } catch (e) {
    return {
      ok: false,
      missing:
        (e?.code === 1 || e?.code === "1") &&
        (!String(e?.stderr || "").trim() ||
          /Bad rule|does a matching rule exist/i.test(String(e.stderr))),
    };
  }
}
async function ruleState(run, rule) {
  for (const args of [
    rule.tagged,
    rule.args,
    ...(rule.legacy ? [rule.legacy] : []),
  ]) {
    const res = await invoke(run, "iptables", [
      "-w",
      "5",
      "-t",
      rule.table,
      "-C",
      rule.chain,
      ...args,
    ]);
    if (res.ok) return "ready";
    // Exit 1 means rule absent; timeout, lock/permission failure => unknown.
    if (!res.missing) return "unknown";
  }
  return "missing";
}
export async function checkNetwork(
  run,
  {
    iface = "awg0",
    port = 51820,
    egress = "",
    repair = false,
    now = Date.now(),
  } = {},
) {
  const health = {
    vpnHealthVersion: 1,
    vpnCheckedAtMs: now,
    vpnInterface: "unknown",
    vpnListener: "unknown",
    vpnForwarding: "unknown",
    vpnNat: "unknown",
    vpnForwardOut: "unknown",
    vpnForwardIn: "unknown",
    vpnUdp: "unknown",
    vpnRepair: repair ? "unchanged" : "disabled",
  };
  if (
    !validInterface(iface) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535 ||
    (egress && !validInterface(egress))
  )
    return health;
  const link = await invoke(run, "ip", [
    "-j",
    "-4",
    "address",
    "show",
    "dev",
    iface,
  ]);
  if (!link.ok) return health;
  let links;
  try {
    links = JSON.parse(link.text);
  } catch {
    return health;
  }
  if (!Array.isArray(links)) return health;
  const device = links.find((x) => x && x.ifname === iface);
  health.vpnInterface = device?.flags?.includes("UP") ? "ready" : "missing";
  if (health.vpnInterface !== "ready") return health;
  const listener = await invoke(run, "awg", ["show", iface, "listen-port"]);
  health.vpnListener =
    listener.ok && /^\d+$/.test(listener.text)
      ? Number(listener.text) === port
        ? "ready"
        : "missing"
      : "unknown";
  if (health.vpnListener !== "ready") return health;
  const subnets = [
    ...new Set(
      (device.addr_info || [])
        .filter((x) => x.family === "inet")
        .map((x) => networkCidr(x.local, x.prefixlen))
        .filter(Boolean),
    ),
  ];
  if (subnets.length !== 1) return health;
  const route = await invoke(run, "ip", [
    "-j",
    "-4",
    "route",
    "show",
    "default",
  ]);
  let routes;
  try {
    routes = route.ok ? JSON.parse(route.text) : [];
  } catch {
    return health;
  }
  if (!Array.isArray(routes)) return health;
  const output = chooseEgress(routes, iface, egress);
  if (!output) return health;
  // Explicit interface still has to exist; never mutate for an invented device.
  const dev = await invoke(run, "ip", ["link", "show", "dev", output]);
  if (!dev.ok) return health;
  health.vpnEgress = output;
  health.vpnSubnet = subnets[0];
  const forward = await invoke(run, "sysctl", ["-n", "net.ipv4.ip_forward"]);
  health.vpnForwarding = forward.ok
    ? forward.text === "1"
      ? "ready"
      : forward.text === "0"
        ? "missing"
        : "unknown"
    : "unknown";
  if (repair && health.vpnForwarding === "missing") {
    const changed = await invoke(run, "sysctl", [
      "-w",
      "net.ipv4.ip_forward=1",
    ]);
    const verified = await invoke(run, "sysctl", ["-n", "net.ipv4.ip_forward"]);
    health.vpnForwarding = verified.ok
      ? verified.text === "1"
        ? "ready"
        : verified.text === "0"
          ? "missing"
          : "unknown"
      : "unknown";
    health.vpnRepair =
      changed.ok && health.vpnForwarding === "ready" ? "applied" : "failed";
  }
  for (const rule of networkRules({
    iface,
    egress: output,
    subnet: subnets[0],
    port,
  })) {
    health[rule.name] = await ruleState(run, rule);
    if (repair && health[rule.name] === "missing") {
      const action =
        rule.table === "nat" ? ["-A", rule.chain] : ["-I", rule.chain, "1"];
      const result = await invoke(run, "iptables", [
        "-w",
        "5",
        "-t",
        rule.table,
        ...action,
        ...rule.tagged,
      ]);
      health[rule.name] = await ruleState(run, rule);
      if (!result.ok || health[rule.name] !== "ready")
        health.vpnRepair = "failed";
      else if (health.vpnRepair !== "failed") health.vpnRepair = "applied";
    }
  }
  return health;
}
export function networkReady(health) {
  return [
    "vpnInterface",
    "vpnListener",
    "vpnForwarding",
    "vpnNat",
    "vpnForwardOut",
    "vpnForwardIn",
    "vpnUdp",
  ].every((key) => health[key] === "ready");
}
export function peerHealth(peers, now = Date.now()) {
  if (!(peers instanceof Map)) return {};
  let recent = 0,
    traffic = 0;
  for (const info of peers.values()) {
    const age = now - info.handshakeUnix * 1000;
    if (info.handshakeUnix > 0 && age >= 0 && age <= 180_000) recent++;
    if (info.rxBytes > 0 && info.txBytes > 0) traffic++;
  }
  return { vpnRecentPeers: recent, vpnBidirectionalPeers: traffic };
}
