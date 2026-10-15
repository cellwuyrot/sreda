import React from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ role: "ADMIN", status: "authenticated" }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { role: session.role } }, status: session.status }) }));
import AdminUserTzIdButton from "./AdminUserTzIdButton";
const id = "cm123actualuserid";
const clipboard = vi.fn();
const fetcher = vi.fn();
function mount() { render(<AdminUserTzIdButton userId={id} userName="Анна" />); }
function click() { fireEvent.click(screen.getByRole("button", { name: "Скопировать TZ ID пользователя Анна" })); }
beforeEach(() => {
  session.role = "ADMIN"; session.status = "authenticated";
  clipboard.mockReset().mockResolvedValue(undefined);
  fetcher.mockReset().mockResolvedValue({ ok: true, json: async () => ({ tzId: id }) });
  vi.stubGlobal("fetch", fetcher);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: clipboard } });
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("TZ ID copy button", () => {
  it.each(["EDITOR", "USER", "CONSULTANT"])("is absent for %s and performs no request", role => {
    session.role = role; mount(); expect(screen.queryByRole("button")).toBeNull(); expect(fetcher).not.toHaveBeenCalled();
  });
  it("is absent before authenticated", () => { session.status = "loading"; mount(); expect(screen.queryByRole("button")).toBeNull(); });
  it("copies only TZ ID after server authorization", async () => {
    mount(); expect(fetcher).not.toHaveBeenCalled(); click(); await screen.findByRole("status");
    expect(clipboard).toHaveBeenCalledWith(id); expect(clipboard).toHaveBeenCalledTimes(1);
    expect(fetcher).toHaveBeenCalledWith(`/api/admin/users/${id}/tz-id`, { cache: "no-store" });
  });
  it.each([401,403,404,500])("does not copy on API %s", async status => {
    fetcher.mockResolvedValue({ ok: false, status }); mount(); click(); await screen.findByRole("alert");
    expect(clipboard).not.toHaveBeenCalled(); expect(screen.queryByRole("status")).toBeNull();
  });
  it("rejects malformed or mismatched identifiers", async () => {
    fetcher.mockResolvedValue({ ok: true, json: async () => ({ tzId: "someone-else" }) });
    mount(); click(); await screen.findByRole("alert"); expect(clipboard).not.toHaveBeenCalled();
  });
  it("shows permission errors instead of a false success and allows retry", async () => {
    clipboard.mockRejectedValueOnce(new Error("NotAllowedError")); mount(); click();
    await screen.findByRole("alert"); expect(screen.queryByRole("status")).toBeNull();
    click(); await screen.findByRole("status"); expect(screen.queryByRole("alert")).toBeNull();
  });
  it("handles unavailable clipboard without requesting identifiers", async () => {
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    mount(); click(); await screen.findByRole("alert"); expect(fetcher).not.toHaveBeenCalled();
  });
  it("handles network failure", async () => {
    fetcher.mockRejectedValue(new Error("Network error")); mount(); click();
    await waitFor(() => expect(screen.getByRole("alert")).not.toBeNull()); expect(clipboard).not.toHaveBeenCalled();
  });
});
