import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { CreateChannelModal, JoinGroupModal } from "./GroupDialogs";
vi.mock("@/components/ui/GlowAvatar", () => ({ default: () => null }));
vi.mock("@/components/ui/InfoTooltip", () => ({ default: () => null }));
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it("channel creation recovers after a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<CreateChannelModal groupId="g" onClose={() => {}} onCreated={() => {}} />);
  const input = screen.getByPlaceholderText("Название канала...");
  expect(input).toHaveFocus();
  fireEvent.change(input, { target: { value: "new-channel" } });
  fireEvent.click(screen.getByRole("button", { name: "Создать" }));
  await screen.findByText("Ошибка сети. Попробуйте позже.");
  expect(screen.getByRole("button", { name: "Создать" })).not.toBeDisabled();
  expect(input).toHaveValue("new-channel");
});
it("invite join recovers after a network failure", async () => {
  vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
  render(<JoinGroupModal onClose={() => {}} onJoined={() => {}} />);
  fireEvent.change(screen.getByPlaceholderText("Код приглашения..."), { target: { value: "invite" } });
  fireEvent.click(screen.getByRole("button", { name: "Присоединиться" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("button", { name: "Присоединиться" })).not.toBeDisabled();
});
