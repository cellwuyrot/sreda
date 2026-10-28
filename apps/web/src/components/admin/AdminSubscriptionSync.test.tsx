import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: "ADMIN" } } }) }));
import Page from "@/app/admin/premium/page";
const user = { id: "user", name: "Customer", username: "customer", role: "USER", isPremium: true, vpnAccess: false, vpnAccessUntil: null, connections: [{ id: "premium", title: "Premium из Business", accessKind: "PREMIUM", status: "ACTIVE", paidUntil: "2099-01-01T00:00:00Z", manualState: "NONE" }] };
const fetcher = vi.fn();
beforeEach(() => { fetcher.mockReset(); fetcher.mockResolvedValue({ ok: true, json: async () => ({ users: [user], page: 1, pages: 1, total: 1, refreshedAt: "2026-10-28T18:00:00Z" }) }); vi.stubGlobal("fetch", fetcher); });
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("shows shared service name and Premium includes VPN without payment forms", async () => {
  render(<Page />); await screen.findByText("Premium из Business");
  expect(screen.getAllByText("Premium, включая соединение").length).toBeGreaterThan(0);
  expect(screen.queryByText("Подписка + оплата")).toBeNull(); expect(screen.queryByText("Реквизиты для оплаты")).toBeNull();
  expect(screen.getByRole("link", { name: /Управлять услугами в Business/ })).toHaveAttribute("href", "https://business.trioz.ru/admin/service-hub");
  expect(fetcher.mock.calls.every(([, init]) => !init.method || init.method === "GET")).toBe(true);
});
it("refreshes from the central source on demand and on focus", async () => {
  render(<Page />); await screen.findByText("Customer");
  fireEvent.click(screen.getByRole("button", { name: "Обновить" }));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
  await screen.findByText("Customer"); fireEvent(window, new Event("focus"));
  await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(3));
});
it("shows failures as unknown rather than absent subscriptions and allows retry", async () => {
  fetcher.mockResolvedValueOnce({ ok: false }); render(<Page />); await screen.findByRole("alert");
  expect(screen.queryByText("Подписка не подключена.")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Обновить" })); await screen.findByText("Customer");
});
