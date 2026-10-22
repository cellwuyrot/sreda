import React from "react";
import { afterEach, describe, it, expect, vi } from "vitest";
import { cleanup, render, screen, fireEvent } from "@testing-library/react";
import AdminPagination from "./AdminPagination";
afterEach(cleanup);
describe("shared admin pagination", () => {
  it("disables both controls for an empty list", () => {
    render(<AdminPagination page={1} pages={1} total={0} onPageChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Назад" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Далее" })).toBeDisabled();
    expect(screen.getByRole("status")).toHaveTextContent("Всего: 0");
  });
  it("navigates and disables controls while loading", () => {
    const change = vi.fn();
    const { rerender } = render(<AdminPagination page={2} pages={3} total={31} onPageChange={change} />);
    fireEvent.click(screen.getByRole("button", { name: "Далее" })); expect(change).toHaveBeenCalledWith(3);
    fireEvent.click(screen.getByRole("button", { name: "Назад" })); expect(change).toHaveBeenCalledWith(1);
    rerender(<AdminPagination page={2} pages={3} total={31} loading onPageChange={change} />);
    for (const button of screen.getAllByRole("button")) expect(button).toBeDisabled();
  });
});
