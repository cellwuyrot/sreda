import { afterEach, it, expect } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import Help from "./AdminHelp";
afterEach(cleanup);
it("does not render an invisible overflowing tooltip", () => {
  render(<Help text="Useful help" />);
  expect(screen.queryByRole("tooltip")).toBeNull();
});
it("opens help for keyboard and touch, outside the form", () => {
  render(<Help text="Useful help" />);
  fireEvent.click(screen.getByRole("button", { name: "Подробнее" }));
  expect(screen.getByRole("tooltip").textContent).toBe("Useful help");
  expect(screen.getByRole("tooltip").parentElement).toBe(document.body);
});
it("Escape dismisses help without navigation", () => {
  render(<Help text="Useful help" />);
  fireEvent.focus(screen.getByRole("button"));
  expect(screen.getByRole("tooltip")).toBeTruthy();
  fireEvent.keyDown(window, { key: "Escape" });
  expect(screen.queryByRole("tooltip")).toBeNull();
});
