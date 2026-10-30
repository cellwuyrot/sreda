import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, act } from "@testing-library/react";
import VpnNodeHealth from "./VpnNodeHealth";
import { VPN_HEALTH_FIELDS } from "@/lib/vpnNodeHealth";
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});
const ready = () => ({
  vpnHealthVersion: 1,
  vpnCheckedAtMs: Date.now(),
  ...Object.fromEntries(VPN_HEALTH_FIELDS.map((k) => [k, "ready"])),
  vpnRecentPeers: 0,
  vpnBidirectionalPeers: 0,
});
describe("VPN health admin card", () => {
  it("separates unknown diagnostics from absent subscriptions or offline users", () => {
    render(<VpnNodeHealth report={null} online />);
    expect(screen.getByText(/нет свежей диагностики/)).toBeTruthy();
    expect(
      screen.getByText(/Действующий доступ пользователей не изменяется/),
    ).toBeTruthy();
  });
  it("warns about missing NAT even with agent online", () => {
    render(<VpnNodeHealth report={{ ...ready(), vpnNat: "missing" }} online />);
    expect(screen.getByText(/требует внимания/)).toBeTruthy();
    expect(screen.getByRole("status").textContent).toContain("NAT");
    expect(screen.getByText("Отсутствует")).toBeTruthy();
  });
  it("labels good config as checked, not working Internet", () => {
    render(<VpnNodeHealth report={ready()} online />);
    expect(screen.getByText(/настройки проверены/)).toBeTruthy();
    expect(screen.getByText(/не гарантия работы интернета/)).toBeTruthy();
  });
  it("does not show old green values as fresh", () => {
    render(<VpnNodeHealth report={{ ...ready(), vpnCheckedAtMs: 1 }} online />);
    expect(screen.getByText(/нет свежей диагностики/)).toBeTruthy();
    expect(screen.queryByText("Есть")).toBeNull();
  });
});

it("expires a green sample even without new API responses", () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(1800000000000));
  render(<VpnNodeHealth report={ready()} online />);
  expect(screen.getByText(/настройки проверены/)).toBeTruthy();
  act(() => {
    vi.advanceTimersByTime(150000);
  });
  expect(screen.getByText(/нет свежей диагностики/)).toBeTruthy();
});
