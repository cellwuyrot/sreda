import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ theme: "dark" }));
vi.mock("@/components/Providers", () => ({ useTheme: () => ({ theme: mocks.theme }) }));
import ConnectWelcome from "./ConnectWelcome";

describe("ConnectWelcome", () => {
  beforeEach(() => { mocks.theme = "dark"; });
  it("shows a static dark gradient and preserves both actions", () => {
    const create = vi.fn(), join = vi.fn();
    const { container } = render(<ConnectWelcome onCreate={create} onJoin={join} />);
    const background = container.querySelector('[data-welcome-background="dark-gradient"]');
    expect(background).toHaveClass("bg-gradient-to-br", "from-black", "via-[#020916]", "to-[#061429]");
    expect(container.querySelector("canvas, video")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Создать пространство" }));
    fireEvent.click(screen.getByRole("button", { name: "Присоединиться" }));
    expect(create).toHaveBeenCalledOnce();
    expect(join).toHaveBeenCalledOnce();
  });
  it("shows a static black background for monochrome", () => {
    mocks.theme = "mono";
    const { container } = render(<ConnectWelcome onCreate={vi.fn()} onJoin={vi.fn()} />);
    const background = container.querySelector('[data-welcome-background="black"]');
    expect(background).toHaveClass("bg-black");
    expect(background).not.toHaveClass("bg-gradient-to-br");
    expect(container.querySelector("canvas, video")).toBeNull();
    expect(screen.getByRole("button", { name: "Создать пространство" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Присоединиться" })).toBeInTheDocument();
  });
  it("switches the static background when the theme changes", () => {
    const { container, rerender } = render(<ConnectWelcome onCreate={vi.fn()} onJoin={vi.fn()} />);
    expect(container.querySelector('[data-welcome-background="dark-gradient"]')).toBeInTheDocument();
    mocks.theme = "mono";
    rerender(<ConnectWelcome onCreate={vi.fn()} onJoin={vi.fn()} />);
    expect(container.querySelector('[data-welcome-background="black"]')).toBeInTheDocument();
    expect(container.querySelector("canvas, video")).toBeNull();
  });
});
