import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

/* Проверяем именно круглый выключатель: он получает расход из общего GET
   независимо от того, пришёл доступ через Premium или отдельный тариф. */
const desktopApi = vi.hoisted(() => ({ get: vi.fn<() => unknown>(() => null) }));
vi.mock("@/lib/desktop", () => ({
  isDesktop: () => false,
  getDesktopApi: desktopApi.get,
}));
vi.mock("@/lib/shell", () => ({ isAndroidShell: () => false }));
vi.mock("@/lib/useLinkMetrics", () => ({
  useLinkMetrics: () => ({
    lost: false,
    pingMs: null,
    speedBusy: false,
    speedMbits: null,
    speedError: "",
    measureSpeed: vi.fn(),
  }),
}));
vi.mock("@/lib/wgIdentity", () => ({ deviceKeyPair: vi.fn() }));
vi.mock("@/lib/wgKeys", () => ({ buildWireGuardConfig: vi.fn() }));
vi.mock("@/lib/amneziaVpnProfile", () => ({ buildAmneziaVpnProfile: vi.fn() }));

const { default: PremiumInfoModal } =
  await import("@/components/connect/overlays/PremiumInfoModal");
const { deviceKeyPair } = await import("@/lib/wgIdentity");
const { buildWireGuardConfig } = await import("@/lib/wgKeys");
const { buildAmneziaVpnProfile } = await import("@/lib/amneziaVpnProfile");

function vpnState(over: Record<string, unknown> = {}) {
  return {
    serviceEnabled: true,
    entitled: true,
    nodeReady: true,
    peer: null,
    plan: { kind: "premium", label: "Premium", until: null },
    // Сервер всё ещё может прислать старые поля учёта — панель их не показывает.
    traffic: {
      usedBytes: 700 * 1024 * 1024,
      remainingBytes: 249 * 1024 * 1024 * 1024,
      limitGb: 250,
      share: 1,
      measuredAt: new Date().toISOString(),
    },
    servers: [],
    ...over,
  };
}

beforeEach(() => {
  desktopApi.get.mockReturnValue(null);
  vi.stubGlobal("fetch", vi.fn());
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("PremiumInfoModal: без отображения учёта трафика", () => {
  it("не показывает данные трафика, даже если сервер их прислал", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState(),
    } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /включить защищённое соединение$/i,
        }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText(/Трафик|Израсходовано|Осталось|Учёт:/i),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /обновить данные/i }),
    ).toBeNull();
  });

  it("экспортирует тот же peer в vpn:// и показывает QR без отправки private key", async () => {
    const peer = {
      address: "10.8.0.7",
      exitIp: "",
      routing: "SERVICES",
      lastHandshakeAt: null,
      nodeId: "node-1",
      node: { name: "Москва", region: "RU" },
      tunnel: {
        serverPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=",
        endpoint: "vpn.example.com:51820",
        allowedIps: "10.20.0.0/16",
        dns: "1.1.1.1",
        serverAddress: "10.8.0.1",
        extra: { Jc: 4 },
      },
    };
    vi.mocked(deviceKeyPair).mockReturnValue({
      privateKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      publicKey: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
    });
    vi.mocked(buildWireGuardConfig).mockReturnValue("READY-CONFIG");
    vi.mocked(buildAmneziaVpnProfile).mockResolvedValue({
      uri: "vpn://TEST_PROFILE",
      wireGuardConfig: "READY-CONFIG",
    });
    vi.mocked(fetch)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => vpnState({ peer }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ peer }),
      } as Response);

    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    const exportButton = await screen.findByRole("button", {
      name: "Скачать профиль для AmneziaVPN",
    });
    fireEvent.click(exportButton);

    await waitFor(() =>
      expect(
        screen.getByRole("button", { name: "Показать QR-код" }),
      ).toBeTruthy(),
    );
    const post = vi.mocked(fetch).mock.calls[1];
    expect(post[0]).toBe("/api/vpn/me");
    const body = JSON.parse((post[1] as RequestInit).body as string);
    expect(body).toEqual({
      publicKey: "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC=",
      routing: "SERVICES",
      nodeId: "node-1",
    });
    expect(JSON.stringify(body)).not.toContain("privateKey");
    expect(buildWireGuardConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        allowedIps: "10.20.0.0/16",
        endpoint: "vpn.example.com:51820",
        extra: { Jc: 4 },
      }),
    );
    expect(buildAmneziaVpnProfile).toHaveBeenCalledWith("READY-CONFIG");

    fireEvent.click(screen.getByRole("button", { name: "Показать QR-код" }));
    expect(await screen.findByTitle("Профиль AmneziaVPN")).toBeTruthy();
  });

  it("не показывает сообщение об отсутствии отчёта узла", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () =>
        vpnState({ traffic: { usedBytes: 0, limitGb: 250, measuredAt: null } }),
    } as Response);

    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /включить защищённое соединение$/i,
        }),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText(
        /Учёт: ждём отчёт узла|Расход пока не учтён|расход с узла ещё не приходил/i,
      ),
    ).toBeNull();
  });

  it("сохраняет проверку общего состояния при временном сбое", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({
      ok: true,
      json: async () => vpnState(),
    } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await waitFor(() =>
      expect(
        screen.getByRole("button", {
          name: /включить защищённое соединение$/i,
        }),
      ).toBeTruthy(),
    );
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    fireEvent.focus(window);
    await waitFor(() =>
      expect(
        screen.getByText("Последние данные могут быть неактуальны"),
      ).toBeTruthy(),
    );
    expect(
      screen.queryByText(/Трафик|Израсходовано|Осталось|Учёт:/i),
    ).toBeNull();
  });

  it("обновляет видимое окно, не опрашивает скрытое и останавливается при закрытии", async () => {
    vi.useFakeTimers();
    const visibility = vi
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("visible");
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState(),
    } as Response);
    const view = render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("hidden");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(fetch).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    await act(async () => {
      fireEvent(document, new Event("visibilitychange"));
    });
    expect(fetch).toHaveBeenCalledTimes(3);
    view.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});

const selectableServers = [
  { id: "node-1", name: "Сервер Москва", region: "RU", ready: true },
  { id: "node-2", name: "Сервер Франкфурт", region: "DE", ready: true },
  { id: "node-full", name: "Сервер заполнен", ready: true, full: true },
  { id: "node-off", name: "Сервер выключен", ready: false },
];
function exportPeer(nodeId: string) {
  return { nodeId, address: "10.8.0.7", exitIp: "", routing: "ALL", lastHandshakeAt: null,
    node: { name: nodeId, region: "DE" },
    tunnel: { serverPublicKey: "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB=", endpoint: `${nodeId}.example:51820`, allowedIps: "0.0.0.0/0", dns: "1.1.1.1", serverAddress: "10.8.0.1" } };
}
function mockProfileExport(peer: ReturnType<typeof exportPeer> | null = null, fail = false) {
  vi.mocked(deviceKeyPair).mockReturnValue({ privateKey: "private-local-only", publicKey: "public-key" });
  vi.mocked(buildWireGuardConfig).mockReturnValue("SELECTED-CONFIG");
  vi.mocked(buildAmneziaVpnProfile).mockResolvedValue({ uri: "vpn://SELECTED", wireGuardConfig: "SELECTED-CONFIG" });
  vi.mocked(fetch).mockImplementation(async (_url, options) => {
    if (options?.method === "POST") {
      const body = JSON.parse(options.body as string);
      if (fail) return { ok: false, json: async () => ({ error: "Выбранный сервер недоступен" }) } as Response;
      return { ok: true, json: async () => ({ peer: exportPeer(body.nodeId) }) } as Response;
    }
    return { ok: true, json: async () => vpnState({ peer, servers: selectableServers }) } as Response;
  });
}

describe("Выбор сервера в браузере", () => {
  it("показывает серверы до первого профиля и не назначает случайный", async () => {
    mockProfileExport();
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await screen.findByRole("button", { name: /Сервер Франкфурт/ });
    const create = screen.getByRole("button", { name: "Скачать профиль для AmneziaVPN" });
    expect((create as HTMLButtonElement).disabled).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: /Сервер Франкфурт/ }));
    expect(fetch).toHaveBeenCalledTimes(1);
    fireEvent.click(create);
    await screen.findByRole("button", { name: "Показать QR-код" });
    const posts = vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST");
    expect(posts).toHaveLength(1);
    expect(JSON.parse(posts[0][1]?.body as string)).toEqual({ publicKey: "public-key", routing: "ALL", nodeId: "node-2" });
    expect(buildWireGuardConfig).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: "node-2.example:51820", privateKey: "private-local-only" }));
  });

  it("не позволяет выбрать переполненный или недоступный сервер", async () => {
    mockProfileExport();
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    const full = await screen.findByRole("button", { name: /Сервер заполнен/ });
    expect((full as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole("button", { name: /Сервер выключен/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it("смена выбора скрывает старый файл и QR до создания нового профиля", async () => {
    mockProfileExport(exportPeer("node-1"));
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: "Скачать профиль для AmneziaVPN" }));
    fireEvent.click(await screen.findByRole("button", { name: "Показать QR-код" }));
    expect(screen.getByTitle("Профиль AmneziaVPN")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Сервер Франкфурт/ }));
    expect(screen.queryByTitle("Профиль AmneziaVPN")).toBeNull();
    expect(screen.queryByRole("button", { name: "Скачать профиль" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Скачать профиль для AmneziaVPN" }));
    await screen.findByRole("button", { name: "Показать QR-код" });
    expect(buildWireGuardConfig).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: "node-2.example:51820" }));
  });

  it("ошибка выбранного узла не запускает автоматическую выдачу на другом", async () => {
    mockProfileExport(null, true);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Сервер Франкфурт/ }));
    fireEvent.click(screen.getByRole("button", { name: "Скачать профиль для AmneziaVPN" }));
    await screen.findByText("Выбранный сервер недоступен");
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(1);
    expect(screen.queryByRole("button", { name: "Скачать профиль" })).toBeNull();
    expect(screen.getByRole("button", { name: /Сервер Франкфурт/ }).getAttribute("aria-pressed")).toBe("true");
  });
});

describe("Выбор сервера: обновление состояния", () => {
  it("сохраняет явный выбор после фонового обновления", async () => {
    mockProfileExport(exportPeer("node-1"));
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Сервер Франкфурт/ }));
    fireEvent.focus(window);
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: /Сервер Франкфурт/ }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(screen.getByRole("button", { name: "Скачать профиль для AmneziaVPN" }));
    await screen.findByRole("button", { name: "Показать QR-код" });
    expect(buildWireGuardConfig).toHaveBeenLastCalledWith(expect.objectContaining({ endpoint: "node-2.example:51820" }));
  });

  it("исчезнувший выбранный сервер не заменяется другим", async () => {
    mockProfileExport();
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    fireEvent.click(await screen.findByRole("button", { name: /Сервер Франкфурт/ }));
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState({ servers: [selectableServers[0]] }) } as Response);
    fireEvent.click(screen.getByRole("button", { name: "Обновить список серверов" }));
    await screen.findByText("Выбранный сервер недоступен. Обновите список или выберите другой.");
    expect((screen.getByRole("button", { name: "Скачать профиль для AmneziaVPN" }) as HTMLButtonElement).disabled).toBe(true);
    expect(screen.getByRole("button", { name: /Сервер Москва/ }).getAttribute("aria-pressed")).toBe("false");
    expect(vi.mocked(fetch).mock.calls.filter(([, options]) => options?.method === "POST")).toHaveLength(0);
  });

  it("обычный подписчик соединения тоже видит выбор сервера, без Premium", async () => {
    mockProfileExport();
    render(<PremiumInfoModal isPremium={false} onClose={vi.fn()} />);
    expect(await screen.findByRole("button", { name: /Сервер Франкфурт/ })).toBeTruthy();
    expect(screen.queryByText("Подключите нужные возможности")).toBeNull();
  });

  it("при отсутствии серверов предлагает обновить список, не выдаёт профиль", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState({ nodeReady: false }) } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    expect(await screen.findByText("Сейчас нет доступных серверов.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Обновить список серверов" })).toBeTruthy();
    expect((screen.getByRole("button", { name: "Скачать профиль для AmneziaVPN" }) as HTMLButtonElement).disabled).toBe(true);
  });
});

it("сохраняет переподключение приложения на явно выбранный новый узел", async () => {
  mockProfileExport(exportPeer("node-1"));
  const up = vi.fn().mockResolvedValue({ state: "on" });
  desktopApi.get.mockReturnValue({ vpn: {
    status: async () => ({ state: "on" }), onState: () => () => {}, up,
  } });
  const originalFetch = vi.mocked(fetch).getMockImplementation()!;
  vi.mocked(fetch).mockImplementation(async (url, options) => {
    if (options?.method === "PATCH") return { ok: true, json: async () => ({ ok: true, peer: exportPeer("node-2") }) } as Response;
    return originalFetch(url, options);
  });
  render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
  fireEvent.click(await screen.findByRole("button", { name: /Сервер Франкфурт/ }));
  await waitFor(() => expect(up).toHaveBeenCalledWith("SELECTED-CONFIG"));
  const mutations = vi.mocked(fetch).mock.calls.filter(([, opts]) => opts?.method);
  expect(mutations.map(([, opts]) => opts?.method)).toEqual(["PATCH", "POST"]);
  expect(JSON.parse(mutations[1][1]?.body as string).nodeId).toBe("node-2");
});
