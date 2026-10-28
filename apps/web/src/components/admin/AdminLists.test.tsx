import React from "react";
import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent, waitFor } from "@testing-library/react";
const auth = vi.hoisted(() => ({ data: { user: { id: "a", role: "ADMIN" } }, status: "authenticated" }));
vi.mock("next-auth/react", () => ({ useSession: () => auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
import Premium from "@/app/admin/premium/page";
import Logs from "@/app/admin/logs/page";
const fetcher = vi.fn();
const users = Array.from({ length: 31 }, (_, i) => ({ id: `u${i}`, name: `User ${i}`, username: `user${i}`, email: `u${i}@example.invalid`, role: "USER", isPremium: false, vpnAccess: false, vpnAccessUntil: null, connections: [] }));
beforeEach(() => {
  fetcher.mockReset(); vi.stubGlobal("fetch", fetcher);
  fetcher.mockImplementation(async (input: string) => {
    const url = new URL(input, "http://localhost");
    const page = Number(url.searchParams.get("page") || 1);
    if (url.pathname === "/api/payments/methods") return { ok: true, json: async () => ({ methods: [] }) };
    if (url.pathname === "/api/admin/logs") return { ok: true, json: async () => ({ logs: [{ id: `l${page}`, username: "admin", action: "update", target: "SiteContent", details: `Record ${page}`, createdAt: new Date().toISOString() }], page, pages: 3, total: 31 }) };
    const q = url.searchParams.get("q");
    return { ok: true, json: async () => ({ users: q ? [] : users.slice((page - 1) * 15, page * 15), page, pages: q ? 1 : 3, total: q ? 0 : 31 }) };
  });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("admin lists", () => {
  it("shows only 15 users, navigates and resets page on search without losing focus", async () => {
    render(<Premium />);
    await screen.findByText("User 0");
    expect(screen.getAllByRole("article")).toHaveLength(15);
    expect(screen.queryByText("User 15")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("User 15");
    expect(screen.queryByText("User 0")).toBeNull();
    const search = screen.getByRole("textbox", { name: "Поиск пользователей" });
    search.focus(); fireEvent.change(search, { target: { value: "missing" } });
    await screen.findByText("Пользователи не найдены.");
    expect(search).toHaveFocus();
    expect(fetcher.mock.calls.some(([url]) => String(url).includes("page=1&q=missing"))).toBe(true);
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
  });
  it("shows failed log loads as an error, not an empty successful journal, and retries", async () => {
    fetcher.mockResolvedValueOnce({ ok: false, status: 403 });
    render(<Logs />);
    await screen.findByRole("alert");
    expect(screen.queryByText("Логи отсутствуют")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Повторить" }));
    await screen.findByText("Record 1");
    fireEvent.click(screen.getByRole("button", { name: "Далее" }));
    await screen.findByText("Record 2");
    fireEvent.click(screen.getByRole("button", { name: "Создание" }));
    await waitFor(() => expect(fetcher.mock.calls.some(([url]) => String(url).includes("page=1&action=create"))).toBe(true));
  });
  it("supports retry for subscription API errors", async () => {
    fetcher.mockImplementation(async (url: string) => ({ ok: url.includes("payments"), json: async () => ({}) }));
    render(<Premium />); await screen.findByRole("alert");
    expect(screen.queryByText("Пользователи не найдены.")).toBeNull();
  });
});
