import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import UserContextMenu from "./UserContextMenu";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/ui/GlowAvatar", () => ({ default: () => null }));
vi.mock("@/components/ui/ProfileBanner", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const props = {
  user: { id: "u", name: "User" }, x: 0, y: 0, currentUserId: "owner", groupId: "g", targetMemberId: "m",
  viewerRole: "OWNER", targetRole: "MEMBER", message: null, targetTags: [], roles: [], targetRoleIds: [],
  nickname: null, ignored: false, onClose: vi.fn(), onMention: vi.fn(), onOpenDm: vi.fn(), onSetNickname: vi.fn(), onToggleIgnore: vi.fn(),
};
it("updates the system-role checkmark without reopening the menu", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => ({}) }));
  render(<UserContextMenu {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /Роль в группе/ }));
  const mod = screen.getByRole("button", { name: "Модератор" });
  expect(mod).not.toBeDisabled();
  fireEvent.click(mod);
  await waitFor(() => expect(screen.getByRole("button", { name: "Модератор" })).toBeDisabled());
  expect(screen.getByRole("button", { name: "Модератор" }).querySelector("svg")).not.toBeNull();
  expect(screen.getByRole("button", { name: "Участник" })).not.toBeDisabled();
});
it("keeps the old role selected if the server rejects the change", async () => {
  vi.stubGlobal("fetch", vi.fn((url: string) => Promise.resolve({ ok: !url.includes("/members/"), json: async () => ({ error: "Forbidden" }) })));
  render(<UserContextMenu {...props} />);
  fireEvent.click(await screen.findByRole("button", { name: /Роль в группе/ }));
  fireEvent.click(screen.getByRole("button", { name: "Модератор" }));
  await screen.findByText("Forbidden");
  expect(screen.getByRole("button", { name: "Участник" })).toBeDisabled();
  expect(screen.getByRole("button", { name: "Модератор" })).not.toBeDisabled();
});
