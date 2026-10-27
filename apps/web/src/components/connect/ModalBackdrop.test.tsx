import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import ModalBackdrop from "./ModalBackdrop";

afterEach(cleanup);
describe("dialog focus regression", () => {
  it("keeps autoFocus in the name input instead of the first button", () => {
    render(<ModalBackdrop onClose={() => {}}><button>Канал</button><input aria-label="Название" autoFocus /></ModalBackdrop>);
    expect(screen.getByLabelText("Название")).toHaveFocus();
  });
  it("does not steal focus when the parent's callback identity changes", () => {
    const first = vi.fn(), second = vi.fn();
    const content = <><button>Канал</button><input aria-label="Название" autoFocus /></>;
    const { rerender } = render(<ModalBackdrop onClose={first}>{content}</ModalBackdrop>);
    const input = screen.getByLabelText("Название");
    fireEvent.change(input, { target: { value: "новый канал" } });
    rerender(<ModalBackdrop onClose={second}>{content}</ModalBackdrop>);
    expect(input).toHaveFocus();
    expect(input).toHaveValue("новый канал");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(second).toHaveBeenCalledOnce();
    expect(first).not.toHaveBeenCalled();
  });
  it("skips disabled buttons when wrapping Tab", () => {
    render(<ModalBackdrop onClose={() => {}}><button disabled>Создать</button><input aria-label="Название" autoFocus /><button>Отмена</button></ModalBackdrop>);
    screen.getByText("Отмена").focus();
    fireEvent.keyDown(document, { key: "Tab" });
    expect(screen.getByLabelText("Название")).toHaveFocus();
  });
});
