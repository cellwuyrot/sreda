import { describe, it, expect } from "vitest";
import {
  readFileSync,
  mkdtempSync,
  writeFileSync,
  chmodSync,
  rmSync,
  mkdirSync,
  existsSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  checkNetwork,
  networkRules,
  networkCidr,
  chooseEgress,
  networkReady,
  peerHealth,
} from "./network.mjs";
const cfg = {
  iface: "awg0",
  egress: "ens3",
  subnet: "10.8.0.0/24",
  port: 51820,
};
function fixture({
  missing = [],
  unknown = false,
  forward = "1",
  down = false,
  routes = [{ dev: "ens3", dst: "default" }],
} = {}) {
  const rules = networkRules(cfg);
  const stored = new Set(
    rules
      .filter((r) => !missing.includes(r.name))
      .map((r) => JSON.stringify([r.table, r.chain, r.args])),
  );
  stored.add("DOCKER-DO-NOT-TOUCH");
  const calls = [];
  let fwd = forward;
  const run = async (file, args) => {
    calls.push([file, args]);
    if (file === "ip") {
      if (args.includes("address"))
        return {
          stdout: JSON.stringify([
            {
              ifname: "awg0",
              flags: down ? [] : ["UP"],
              addr_info: [{ family: "inet", local: "10.8.0.1", prefixlen: 24 }],
            },
          ]),
        };
      if (args.includes("route")) return { stdout: JSON.stringify(routes) };
      return { stdout: "" };
    }
    if (file === "awg") return { stdout: "51820" };
    if (file === "sysctl") {
      if (args[0] === "-w") fwd = "1";
      return { stdout: fwd };
    }
    if (file === "iptables") {
      const [table, action, chain] = [args[3], args[4], args[5]];
      const tail = args.slice(action === "-I" ? 7 : 6);
      const key = JSON.stringify([table, chain, tail]);
      if (unknown)
        throw Object.assign(Error("secret command stderr"), {
          code: 4,
          stderr: "Permission denied",
        });
      if (action === "-C") {
        if (!stored.has(key)) throw Object.assign(Error("absent"), { code: 1 });
      } else if (action === "-A" || action === "-I") stored.add(key);
      else throw Error("Unexpected mutation");
      return { stdout: "" };
    }
    throw Error("Unexpected tool");
  };
  return { run, stored, calls };
}
const writes = (f) =>
  f.calls.filter(
    ([tool, args]) =>
      (tool === "iptables" && (args.includes("-A") || args.includes("-I"))) ||
      (tool === "sysctl" && args.includes("-w")),
  );
describe("VPN network lifecycle", () => {
  it("detects missing NAT in the reported production case, without mutating in preview", async () => {
    const f = fixture({ missing: ["vpnNat"] });
    const h = await checkNetwork(f.run, { iface: "awg0" });
    expect(h.vpnNat).toBe("missing");
    expect(h.vpnForwardOut).toBe("ready");
    expect(networkReady(h)).toBe(false);
    expect(writes(f)).toEqual([]);
  });
  it("repairs only missing NAT and does not duplicate it on the second run", async () => {
    const f = fixture({ missing: ["vpnNat"] });
    const h = await checkNetwork(f.run, { repair: true });
    expect(networkReady(h)).toBe(true);
    expect(h.vpnRepair).toBe("applied");
    expect(writes(f)).toHaveLength(1);
    expect(writes(f)[0][1]).toContain("-A"); // generic NAT must not shadow per-peer SNAT
    const again = await checkNetwork(f.run, { repair: true });
    expect(again.vpnRepair).toBe("unchanged");
    expect(writes(f)).toHaveLength(1);
    expect(f.stored.has("DOCKER-DO-NOT-TOUCH")).toBe(true);
  });
  it("rebuilds after a simulated reboot/firewall rule loss", async () => {
    const f = fixture({
      missing: ["vpnNat", "vpnForwardOut", "vpnForwardIn", "vpnUdp"],
      forward: "0",
    });
    expect(networkReady(await checkNetwork(f.run, { repair: true }))).toBe(
      true,
    );
    expect(writes(f)).toHaveLength(5);
    for (const key of [...f.stored])
      if (key !== "DOCKER-DO-NOT-TOUCH") f.stored.delete(key);
    expect(networkReady(await checkNetwork(f.run, { repair: true }))).toBe(
      true,
    );
    expect(writes(f)).toHaveLength(9);
    expect(f.stored.has("DOCKER-DO-NOT-TOUCH")).toBe(true);
    expect(
      f.calls.some(([, a]) =>
        a.some((x) =>
          ["-F", "--flush", "-X", "DOCKER", "DOCKER-USER"].includes(x),
        ),
      ),
    ).toBe(false);
  });
  it("permission or lock failures are unknown, never rule absence", async () => {
    const f = fixture({ unknown: true });
    const h = await checkNetwork(f.run, { repair: true });
    expect(h.vpnNat).toBe("unknown");
    expect(writes(f)).toHaveLength(0);
    expect(JSON.stringify(h)).not.toContain("secret");
  });
  it("does not mutate a down interface", async () => {
    const f = fixture({ down: true });
    const h = await checkNetwork(f.run, { repair: true });
    expect(h.vpnInterface).toBe("missing");
    expect(writes(f)).toHaveLength(0);
  });
  it("does not guess an egress with ambiguous defaults", async () => {
    const f = fixture({ routes: [{ dev: "ens3" }, { dev: "eth1" }] });
    const h = await checkNetwork(f.run, { repair: true });
    expect(h.vpnNat).toBe("unknown");
    expect(writes(f)).toHaveLength(0);
  });
  it("verifies mutations instead of claiming success", async () => {
    const f = fixture({ missing: ["vpnNat"] });
    const run = async (tool, args) => {
      if (tool === "iptables" && args.includes("-A"))
        throw Object.assign(Error("denied"), { code: 4 });
      return f.run(tool, args);
    };
    const h = await checkNetwork(run, { repair: true });
    expect(h.vpnNat).toBe("missing");
    expect(h.vpnRepair).toBe("failed");
  });
  it.each([";reboot", "-x", "awg0\nreboot", "a".repeat(16)])(
    "rejects invalid iface %j",
    async (iface) => {
      const f = fixture();
      await checkNetwork(f.run, { iface, repair: true });
      expect(f.calls).toHaveLength(0);
    },
  );
  it("invalid JSON/commands are not healthy and never leak raw error output", async () => {
    expect(
      networkReady(
        await checkNetwork(async () => ({ stdout: "not-json" }), {
          repair: true,
        }),
      ),
    ).toBe(false);
  });
  it("keeps legacy FORWARD rules without adding duplicates", async () => {
    const f = fixture({ missing: ["vpnForwardOut", "vpnForwardIn"] });
    for (const r of networkRules(cfg).filter((r) => r.legacy))
      f.stored.add(JSON.stringify([r.table, r.chain, r.legacy]));
    expect(networkReady(await checkNetwork(f.run, { repair: true }))).toBe(
      true,
    );
    expect(writes(f)).toHaveLength(0);
  });
  it("uses default route metric, not eth0 hardcoding", () => {
    expect(
      chooseEgress(
        [
          { dev: "ens3", metric: 10 },
          { dev: "eth0", metric: 20 },
        ],
        "awg0",
      ),
    ).toBe("ens3");
    expect(chooseEgress([{ dev: "ens3" }], "awg0", "awg0")).toBeNull();
  });
  it.each([
    ["10.8.0.7", 24, "10.8.0.0/24"],
    ["10.9.7.1", 20, "10.9.0.0/20"],
    ["999.2.3.4", 24, null],
    ["10.8.0.1", 0, null],
  ])("normalizes %s/%s", (a, p, want) => expect(networkCidr(a, p)).toBe(want));
  it("no peers is not a network failure; historical traffic is not a live Internet probe", () => {
    expect(peerHealth(new Map(), 1_000_000)).toEqual({
      vpnRecentPeers: 0,
      vpnBidirectionalPeers: 0,
    });
    expect(
      peerHealth(
        new Map([
          ["x", { handshakeUnix: 999, rxBytes: 1, txBytes: 1 }],
          ["old", { handshakeUnix: 1, rxBytes: 2, txBytes: 3 }],
        ]),
        1_000_000,
      ),
    ).toEqual({ vpnRecentPeers: 1, vpnBidirectionalPeers: 2 });
    expect(peerHealth(null)).toEqual({});
  });
  it("unit wrapper adopts live interface without calling down/up", () => {
    const dir = mkdtempSync(join(tmpdir(), "trioz-wrapper-"));
    try {
      writeFileSync(join(dir, "awg"), "#!/bin/sh\nexit 0\n");
      chmodSync(join(dir, "awg"), 0o755);
      writeFileSync(join(dir, "awg-quick"), "#!/bin/sh\nexit 99\n");
      chmodSync(join(dir, "awg-quick"), 0o755);
      execFileSync(
        "bash",
        [
          new URL("../../../deploy/awg-interface-start.sh", import.meta.url)
            .pathname,
          "awg0",
        ],
        { env: { ...process.env, PATH: dir + ":" + process.env.PATH } },
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
  it("installer never removes shared-subnet NAT during legacy cleanup or persists Docker snapshot", () => {
    const s = readFileSync(
      new URL("../../../deploy/awg-node.sh", import.meta.url),
      "utf8",
    );
    const purge = s.slice(
      s.indexOf("purge_wireguard()"),
      s.indexOf("reset_all()"),
    );
    expect(purge).not.toContain("iptables -t nat -D");
    expect(s).not.toContain("netfilter-persistent save");
    expect(s).toContain("awg-network-repair.sh");
  });
});

describe("existing-node repair script (isolated filesystem and mocked systemd)", () => {
  function harness({ helperExit = 0, port = "51820" } = {}) {
    const dir = mkdtempSync(join(tmpdir(), "trioz-network-install-"));
    const project = join(dir, "project");
    for (const p of [
      "project/deploy",
      "project/apps/vpn/src",
      "bin",
      "etc/systemd/system",
    ])
      mkdirSync(join(dir, p), { recursive: true });
    let script = readFileSync(
      new URL("../../../deploy/awg-network-repair.sh", import.meta.url),
      "utf8",
    );
    for (const prefix of [
      "/etc/systemd/system",
      "/usr/lib/systemd/system",
      "/usr/local/lib/trioz-vpn",
      "/var/backups/trioz-vpn-network",
    ])
      script = script.replaceAll(prefix, dir + prefix);
    writeFileSync(join(project, "deploy/awg-network-repair.sh"), script);
    writeFileSync(
      join(project, "deploy/awg-interface-start.sh"),
      readFileSync(
        new URL("../../../deploy/awg-interface-start.sh", import.meta.url),
      ),
    );
    writeFileSync(
      join(project, "apps/vpn/src/network-cli.mjs"),
      `console.log('CHECK');process.exit(${helperExit})`,
    );
    writeFileSync(
      join(dir, "etc/systemd/system/trioz-vpn-agent.service"),
      "existing service; secret placeholder must remain unchanged",
    );
    const bin = (name, text) => {
      writeFileSync(join(dir, "bin", name), "#!/bin/sh\n" + text + "\n");
      chmodSync(join(dir, "bin", name), 0o755);
    };
    bin("id", "echo 0");
    bin("awg", `echo ${port}`);
    bin("systemctl", `echo "$*" >> '${dir}/systemctl-calls'`);
    const execute = (args = []) =>
      execFileSync(
        "bash",
        [join(project, "deploy/awg-network-repair.sh"), ...args],
        {
          env: {
            ...process.env,
            NODE_BIN: process.execPath,
            PATH: join(dir, "bin") + ":" + process.env.PATH,
          },
          encoding: "utf8",
          stdio: "pipe",
        },
      );
    return { dir, execute };
  }
  it("preview does not write service overrides or restart anything", () => {
    const h = harness();
    try {
      expect(h.execute()).toContain("CHECK");
      expect(existsSync(h.dir + "/systemctl-calls")).toBe(false);
      expect(
        existsSync(h.dir + "/etc/systemd/system/awg-quick@awg0.service.d"),
      ).toBe(false);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
  it("apply adopts live interface, retains credentials, and is repeatable", () => {
    const h = harness();
    try {
      h.execute(["--apply"]);
      h.execute(["--apply"]);
      const calls = readFileSync(h.dir + "/systemctl-calls", "utf8");
      expect(calls).toContain("start awg-quick@awg0");
      expect(calls).not.toContain("restart awg-quick");
      expect(calls).not.toContain("docker");
      expect(
        readFileSync(
          h.dir + "/etc/systemd/system/trioz-vpn-agent.service",
          "utf8",
        ),
      ).toContain("secret placeholder");
      const drop = readFileSync(
        h.dir +
          "/etc/systemd/system/awg-quick@awg0.service.d/20-trioz-network.conf",
        "utf8",
      );
      expect(drop).toContain("ExecStart=\n");
      expect(drop).toContain("ensure-interface.sh %i");
      expect(drop).toContain("--repair");
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
  it("failed repair cannot report success or install persistent overrides", () => {
    const h = harness({ helperExit: 2 });
    try {
      expect(() => h.execute(["--apply"])).toThrow();
      expect(
        existsSync(h.dir + "/etc/systemd/system/awg-quick@awg0.service.d"),
      ).toBe(false);
      expect(readFileSync(h.dir + "/systemctl-calls", "utf8")).not.toContain(
        "restart",
      );
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
  it("refuses a port mismatch before persistent changes", () => {
    const h = harness();
    try {
      expect(() => h.execute(["--port=31558", "--apply"])).toThrow();
      expect(existsSync(h.dir + "/systemctl-calls")).toBe(false);
    } finally {
      rmSync(h.dir, { recursive: true, force: true });
    }
  });
});

it("port mismatch never opens an unrelated port or changes firewall", async () => {
  const f = fixture();
  const h = await checkNetwork(f.run, { port: 31558, repair: true });
  expect(h.vpnListener).toBe("missing");
  expect(writes(f)).toHaveLength(0);
});
