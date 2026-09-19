import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

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

const { default: PremiumInfoModal } = await import("@/components/connect/overlays/PremiumInfoModal");

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
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState() } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /включить защищённое соединение$/i })).toBeTruthy());
    expect(screen.queryByText(/Трафик|Израсходовано|Осталось|Учёт:/i)).toBeNull();
    expect(screen.queryByRole("button", { name: /обновить данные/i })).toBeNull();
  });

  it("не показывает сообщение об отсутствии отчёта узла", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState({ traffic: { usedBytes: 0, limitGb: 250, measuredAt: null } }),
    } as Response);

    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByRole("button", { name: /включить защищённое соединение$/i })).toBeTruthy());
    expect(screen.queryByText(/Учёт: ждём отчёт узла|Расход пока не учтён|расход с узла ещё не приходил/i)).toBeNull();
  });

  it("сохраняет проверку общего состояния при временном сбое", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => vpnState() } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /включить защищённое соединение$/i })).toBeTruthy());
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByText("Последние данные могут быть неактуальны")).toBeTruthy());
    expect(screen.queryByText(/Трафик|Израсходовано|Осталось|Учёт:/i)).toBeNull();
  });

  it("обновляет видимое окно, не опрашивает скрытое и останавливается при закрытии", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState() } as Response);
    const view = render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await act(async () => { await Promise.resolve(); });
    expect(fetch).toHaveBeenCalledTimes(1);
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("hidden");
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(2);
    visibility.mockReturnValue("visible");
    await act(async () => { fireEvent(document, new Event("visibilitychange")); });
    expect(fetch).toHaveBeenCalledTimes(3);
    view.unmount();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(fetch).toHaveBeenCalledTimes(3);
  });
});
