import React from "react";
import { afterEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import FullscreenButton from "./FullscreenButton";
afterEach(() => { cleanup(); vi.restoreAllMocks(); Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null }); });
it("requests native fullscreen on the media surface and handles Esc", async () => {
  const { container } = render(<div data-fullscreen-target><FullscreenButton /></div>);
  const target = container.firstElementChild!;
  const request = vi.fn(async () => {
    Object.defineProperty(document, "fullscreenElement", { configurable: true, value: target });
    document.dispatchEvent(new Event("fullscreenchange"));
  });
  Object.defineProperty(target, "requestFullscreen", { value: request });
  fireEvent.click(screen.getByRole("button", { name: "На весь экран" }));
  expect(request).toHaveBeenCalledOnce();
  expect(await screen.findByRole("button", { name: "Выйти из полноэкранного режима" })).toBeInTheDocument();
  Object.defineProperty(document, "fullscreenElement", { configurable: true, value: null });
  fireEvent(document, new Event("fullscreenchange"));
  expect(screen.getByRole("button", { name: "На весь экран" })).toBeInTheDocument();
});
it("reports fullscreen permission errors instead of rejecting silently", async () => {
  const { container } = render(<div data-fullscreen-target><FullscreenButton /></div>);
  Object.defineProperty(container.firstElementChild, "requestFullscreen", { value: vi.fn().mockRejectedValue(new Error("denied")) });
  fireEvent.click(screen.getByRole("button"));
  await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Не удалось открыть полный экран"));
});
