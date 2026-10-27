import React from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import RoleManager from "./RoleManager";
vi.mock("@/components/ui/InfoTooltip", () => ({ default: () => null }));
const members = () => [{ userId: "u", name: "User", roleIds: [] as string[] }];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: true, json: async () => [{ id: "r", name: "Role", color: "red" }] }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
async function open() {
  const view = render(<RoleManager groupId="g" canManage members={members()} />);
  fireEvent.click(await screen.findByLabelText("Assign members"));
  return view;
}
it("keeps successful assignments when parent recreates the members array", async () => {
  const { rerender } = await open();
  fireEvent.click(screen.getByRole("checkbox"));
  await waitFor(() => expect(screen.getByRole("checkbox")).not.toBeDisabled());
  rerender(<RoleManager groupId="g" canManage members={members()} />);
  expect(screen.getByRole("checkbox")).toBeChecked();
});
it.each(["http", "network"])("rolls back a failed %s assignment and releases loading", async failure => {
  await open();
  const fetchMock = vi.mocked(fetch);
  if (failure === "http") fetchMock.mockResolvedValueOnce({ ok: false } as Response);
  else fetchMock.mockRejectedValueOnce(new Error("offline"));
  fireEvent.click(screen.getByRole("checkbox"));
  expect(await screen.findByRole("alert")).toHaveTextContent("Не удалось изменить роль");
  expect(screen.getByRole("checkbox")).not.toBeChecked();
  expect(screen.getByRole("checkbox")).not.toBeDisabled();
});
