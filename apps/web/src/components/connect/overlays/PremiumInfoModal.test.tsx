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
vi.mock("@/lib/desktop", () => ({
  isDesktop: () => false,
  getDesktopApi: () => null,
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
