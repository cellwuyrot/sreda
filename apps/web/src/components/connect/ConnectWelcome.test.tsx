import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ theme: "dark", index: 0 }));
vi.mock("@/components/Providers", () => ({ useTheme: () => ({ theme: mocks.theme }) }));
vi.mock("next/dynamic", () => ({ default: () => {
  const id = mocks.index++ === 0 ? "topography" : "particles";
  return () => <div data-testid={id} />;
}}));
import ConnectWelcome from "./ConnectWelcome";
describe("ConnectWelcome", () => {
  beforeEach(() => { mocks.theme = "dark"; });
  it("shows the ordinary scene and preserves the create/join actions", () => {
    const create = vi.fn(), join = vi.fn(); render(<ConnectWelcome onCreate={create} onJoin={join} />);
    expect(screen.getByTestId("topography")).toBeInTheDocument(); expect(screen.queryByTestId("particles")).not.toBeInTheDocument();
    fireEvent.click(screen.getByText("Создать пространство")); fireEvent.click(screen.getByText("Присоединиться"));
    expect(create).toHaveBeenCalledOnce(); expect(join).toHaveBeenCalledOnce();
  });
  it("shows only the particle scene in the premium theme", () => {
    mocks.theme = "mono"; render(<ConnectWelcome onCreate={vi.fn()} onJoin={vi.fn()} />);
    expect(screen.getByTestId("particles")).toBeInTheDocument(); expect(screen.queryByTestId("topography")).not.toBeInTheDocument();
  });
});
