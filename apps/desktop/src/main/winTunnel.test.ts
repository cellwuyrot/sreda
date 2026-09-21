import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  windowsTunnelDown,
  type TunnelServiceSnapshot,
  type TunnelShutdownRuntime,
} from "./winTunnel";
import { cleanupAfterFailedStart, cleanupVpnBeforeExit, vpnNeedsCleanup } from "./vpnLifecycle";

const missing = (): TunnelServiceSnapshot[] => [
  { name: "AmneziaWGTunnel$trioz", state: "MISSING", pid: null },
  { name: "WireGuardTunnel$trioz", state: "MISSING", pid: null },
];
const service = (state: TunnelServiceSnapshot["state"], pid = 42): TunnelServiceSnapshot[] => [
  { name: "AmneziaWGTunnel$trioz", state, pid: state === "MISSING" ? null : pid },
  { name: "WireGuardTunnel$trioz", state: "MISSING", pid: null },
];

function runtime(input: {
  services: TunnelServiceSnapshot[][];
  processes?: boolean[];
  adapters?: string[];
  discoveredPids?: number[];
  fallbackServices?: TunnelServiceSnapshot[][];
}): TunnelShutdownRuntime & {
  uninstall: ReturnType<typeof vi.fn>;
  fallback: ReturnType<typeof vi.fn>;
  removeConfig: ReturnType<typeof vi.fn>;
  sleeps: number[];
} {
  let now = 0;
  let serviceIndex = 0;
  let processIndex = 0;
  let adapterIndex = 0;
  let afterFallback = false;
  const sleeps: number[] = [];
  const uninstall = vi.fn(async () => {});
  const fallback = vi.fn(async () => {
    afterFallback = true;
    serviceIndex = 0;
  });
  const removeConfig = vi.fn();
  return {
    now: () => now,
    sleep: async (ms) => { sleeps.push(ms); now += ms; },
    services: async () => {
      const list = afterFallback && input.fallbackServices ? input.fallbackServices : input.services;
      return list[Math.min(serviceIndex++, list.length - 1)];
    },
    discoverPids: async () => input.discoveredPids ?? [],
    processExists: async () => input.processes?.[Math.min(processIndex++, (input.processes?.length ?? 1) - 1)] ?? false,
    adapterStatus: async () => input.adapters?.[Math.min(adapterIndex++, (input.adapters?.length ?? 1) - 1)] ?? "",
    uninstall,
    fallback,
    removeConfig,
    sleeps,
  };
}

describe("windowsTunnelDown lifecycle", () => {
  beforeEach(() => vi.clearAllMocks());

  it("normal disconnect: STOP_PENDING → STOPPED → service missing → process/adapter gone", async () => {
    const rt = runtime({
      services: [service("RUNNING"), service("STOP_PENDING"), service("STOPPED"), missing()],
      processes: [false],
      adapters: [""],
    });
    await windowsTunnelDown("", rt);
    expect(rt.uninstall).toHaveBeenCalledOnce();
    expect(rt.fallback).not.toHaveBeenCalled();
    expect(rt.removeConfig).toHaveBeenCalledOnce();
    expect(rt.sleeps.length).toBeGreaterThan(0);
  });

  it("ждёт службу в STOP_PENDING, а не считает uninstall завершением", async () => {
    const rt = runtime({
      services: [
        service("RUNNING"),
        service("STOP_PENDING"),
        service("STOP_PENDING"),
        service("STOPPED"),
        missing(),
      ],
    });
    await windowsTunnelDown("", rt);
    expect(rt.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(rt.fallback).not.toHaveBeenCalled();
  });

  it("при долгом STOP_PENDING использует только targeted fallback", async () => {
    const rt = runtime({
      services: [service("RUNNING", 777), service("STOP_PENDING", 777)],
      fallbackServices: [missing()],
    });
    await windowsTunnelDown("", rt);
    expect(rt.fallback).toHaveBeenCalledWith(expect.any(String), [777]);
    expect(rt.removeConfig).toHaveBeenCalledOnce();
  });

  it("служба уже отсутствует — shutdown идемпотентен", async () => {
    const rt = runtime({ services: [missing()], adapters: [""] });
    await windowsTunnelDown("", rt);
    expect(rt.fallback).not.toHaveBeenCalled();
    expect(rt.removeConfig).toHaveBeenCalledOnce();
  });

  it("после удаления службы ждёт завершения PID именно tunnel service", async () => {
    const rt = runtime({
      services: [service("RUNNING", 314), service("STOPPED", 314), missing()],
      processes: [true, true, false],
    });
    await windowsTunnelDown("", rt);
    expect(rt.sleeps.length).toBeGreaterThanOrEqual(2);
    expect(rt.fallback).not.toHaveBeenCalled();
  });

  it("после перезапуска ждёт orphan PID, найденный по trioz.conf", async () => {
    const rt = runtime({
      services: [missing()],
      discoveredPids: [909],
      processes: [true, false],
      adapters: [""],
    });
    await windowsTunnelDown("", rt);
    expect(rt.sleeps.length).toBeGreaterThan(0);
    expect(rt.fallback).not.toHaveBeenCalled();
  });

  it("оставшийся адаптер trioz вызывает fallback и финальную проверку", async () => {
    const rt = runtime({ services: [missing()], adapters: ["Up"] });
    let fallbackDone = false;
    rt.fallback = vi.fn(async () => { fallbackDone = true; });
    rt.adapterStatus = async () => fallbackDone ? "" : "Up";
    await windowsTunnelDown("", rt);
    expect(rt.fallback).toHaveBeenCalledOnce();
    expect(rt.removeConfig).toHaveBeenCalledOnce();
  });

  it("не удаляет профиль и возвращает ошибку, пока residue подтверждённо остаётся", async () => {
    const rt = runtime({
      services: [service("STOP_PENDING", 55)],
      fallbackServices: [service("STOP_PENDING", 55)],
      processes: [true],
      adapters: ["Up"],
    });
    await expect(windowsTunnelDown("", rt)).rejects.toThrow(/не завершился полностью/);
    expect(rt.removeConfig).not.toHaveBeenCalled();
  });
});

describe("VPN lifecycle decisions", () => {
  it("state=error всё равно требует cleanup при реальном tunnel", () => {
    expect(vpnNeedsCleanup("error", true)).toBe(true);
    expect(vpnNeedsCleanup("error", false)).toBe(false);
  });

  it("закрытие приложения при state=off ждёт cleanup orphaned tunnel", () => {
    expect(vpnNeedsCleanup("off", true)).toBe(true);
  });

  it("before-quit дожидается cleanup реально существующего tunnel", async () => {
    const order: string[] = [];
    await cleanupVpnBeforeExit(
      async () => { order.push("check"); return true; },
      async () => { order.push("cleanup:start"); await Promise.resolve(); order.push("cleanup:end"); },
    );
    expect(order).toEqual(["check", "cleanup:start", "cleanup:end"]);
  });

  it("ошибка после частичного vpnUp запускает best-effort cleanup", async () => {
    const cleanup = vi.fn(async () => { throw new Error("secondary cleanup error"); });
    await expect(cleanupAfterFailedStart(cleanup)).resolves.toBeUndefined();
    expect(cleanup).toHaveBeenCalledOnce();
  });

  it("после перезапуска orphaned tunnel определяется при начальном state=off", () => {
    expect(vpnNeedsCleanup("off", true)).toBe(true);
  });
});