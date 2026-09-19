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
vi.mock("@/components/connect/PremiumMark", () => ({
  default: ({ onClick }: { onClick?: () => void }) => (
    <button type="button" aria-label="Открыть информацию о premium" onClick={onClick}>
      TZ
    </button>
  ),
}));

const { default: PremiumInfoModal } = await import("@/components/connect/overlays/PremiumInfoModal");
const { default: ConnectionMenu } = await import("@/components/connect/overlays/ConnectionMenu");

function vpnState(over: Record<string, unknown> = {}) {
  return {
    serviceEnabled: true,
    entitled: true,
    nodeReady: true,
    peer: null,
    plan: { kind: "premium", label: "Premium", until: null },
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

describe("PremiumInfoModal: расход на кнопке VPN", () => {
  it("отсутствующая телеметрия не становится нулевым расходом или безлимитом", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState({ traffic: null }) } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /учёт трафика недоступен/i })).toBeTruthy());
    expect(screen.queryByText(/израсходовано 0 ГБ/i)).toBeNull();
    expect(screen.queryByText("Без ограничения")).toBeNull();
  });

  it("сохраняет последнее показание и отмечает сбой обновления", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => vpnState() } as Response);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: /израсходовано 700 МБ/i })).toBeTruthy());
    vi.mocked(fetch).mockRejectedValue(new Error("offline"));
    fireEvent.focus(window);
    await waitFor(() => expect(screen.getByRole("button", { name: /учёт устарел · было 700 МБ/i })).toBeTruthy());
    expect(screen.getByText("Последние данные могут быть неактуальны")).toBeTruthy();
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

  it("показывает подтверждённый расход на выключателе Premium", async () => {
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState() } as Response);

    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /включить защищённое соединение\. израсходовано 700 МБ/i })).toBeTruthy();
    });
  });

  it("тот же выключатель и расход доступны с «Ускоренным интернетом»", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState({ plan: { kind: "link", label: "Ускоренный интернет", until: null } }),
    } as Response);

    render(<PremiumInfoModal isPremium={false} onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /включить защищённое соединение\. израсходовано 700 МБ/i })).toBeTruthy();
    });
  });

  it("до первого отчёта не подменяет неизвестный расход нулём", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState({ traffic: { usedBytes: 0, limitGb: 250, measuredAt: null } }),
    } as Response);

    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByRole("button", { name: /включить защищённое соединение\. учёт: ждём отчёт узла\. нет данных/i })).toBeTruthy();
    });
    expect(screen.getByText("Нет данных")).toBeTruthy();
    expect(screen.queryByText(/израсходовано 0 ГБ/i)).toBeNull();
  });

  it("показывает фактический расход и не обещает сброс безлимитного лимита", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState({
        plan: { kind: "premium", label: "Администратор", until: null },
        traffic: {
          usedBytes: 700 * 1024 * 1024,
          remainingBytes: null,
          limitGb: 0,
          periodEnd: new Date(Date.now() + 86_400_000).toISOString(),
          measuredAt: new Date().toISOString(),
        },
      }),
    } as Response);

    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);

    await waitFor(() => expect(screen.getByText("без ограничения")).toBeTruthy());
    expect(screen.getByText(/израсходовано 700 МБ/i)).toBeTruthy();
    expect(screen.queryByText(/сброс/i)).toBeNull();
  });

  it("ручное обновление в модальном окне делает только GET и показывает индикатор", async () => {
    let resolveFetch!: (response: Response) => void;
    const pending = new Promise<Response>((resolve) => { resolveFetch = resolve; });
    vi.mocked(fetch).mockReturnValueOnce(pending);
    render(<PremiumInfoModal isPremium onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole("button", { name: "Обновить данные расхода" })).toBeDisabled());

    resolveFetch({ ok: true, json: async () => vpnState() } as Response);
    await waitFor(() => expect(screen.getByRole("button", { name: "Обновить данные расхода" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Обновить данные расхода" }));
    expect(screen.getByRole("button", { name: "Обновить данные расхода" })).toBeDisabled();
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).toMatchObject({ cache: "no-store" });
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).not.toHaveProperty("method");
  });
});

describe("ConnectionMenu: обновление расхода", () => {
  it("показывает Нет данных без подмены нулём и фактический расход при limit=0", async () => {
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState({ traffic: { usedBytes: 0, limitGb: 250, measuredAt: null } }),
    } as Response);
    render(<ConnectionMenu isPremium={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть информацию о premium" }));
    await waitFor(() => expect(screen.getByRole("dialog", { name: /надёжное соединение/i })).toBeTruthy());
    expect(screen.getByText("Нет данных")).toBeTruthy();
    expect(screen.queryByText(/израсходовано 0 ГБ/i)).toBeNull();

    cleanup();
    vi.mocked(fetch).mockResolvedValue({
      ok: true,
      json: async () => vpnState({ traffic: { usedBytes: 700 * 1024 * 1024, remainingBytes: null, limitGb: 0, measuredAt: new Date().toISOString() } }),
    } as Response);
    render(<ConnectionMenu isPremium={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть информацию о premium" }));
    await waitFor(() => expect(screen.getByText(/израсходовано 700 МБ/i)).toBeTruthy());
    expect(screen.getByText("без ограничения")).toBeTruthy();
    expect(screen.queryByText(/сброс/i)).toBeNull();
  });

  it("обновляет только открытое видимое меню, чистит polling и дедуплицирует focus", async () => {
    vi.useFakeTimers();
    const visibility = vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
    vi.mocked(fetch).mockResolvedValue({ ok: true, json: async () => vpnState() } as Response);
    const view = render(<ConnectionMenu isPremium={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть информацию о premium" }));
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
    await act(async () => { fireEvent(window, new Event("focus")); });
    expect(fetch).toHaveBeenCalledTimes(4);
    view.unmount();
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000); });
    expect(fetch).toHaveBeenCalledTimes(4);
  });

  it("ручное обновление использует только GET и сохраняет последний снимок при ошибке", async () => {
    vi.mocked(fetch).mockResolvedValueOnce({ ok: true, json: async () => vpnState() } as Response);
    render(<ConnectionMenu isPremium={true} />);
    fireEvent.click(screen.getByRole("button", { name: "Открыть информацию о premium" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Обновить данные соединения" })).toBeTruthy());
    vi.mocked(fetch).mockRejectedValueOnce(new Error("offline"));
    fireEvent.click(screen.getByRole("button", { name: "Обновить данные соединения" }));
    await waitFor(() => expect(screen.getByText("Данные могут быть неактуальны")).toBeTruthy());
    expect(screen.getByText(/учёт устарел: 700 МБ/i)).toBeTruthy();
    expect(vi.mocked(fetch).mock.calls[1]?.[1]).not.toHaveProperty("method");
  });
});
