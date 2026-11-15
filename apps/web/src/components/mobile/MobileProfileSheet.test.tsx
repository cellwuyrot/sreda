import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const state = vi.hoisted(() => ({ role: "ADMIN", push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock("next-auth/react", () => ({ useSession: () => ({ data: { user: { name: "Test", username: "test", role: state.role } } }), signOut: vi.fn() }));
vi.mock("@/hooks/usePushDevice", () => ({ unregisterShellPushDevice: vi.fn() }));
vi.mock("@/components/mobile/BottomSheet", () => ({ default: ({ open, children }: { open: boolean; children: React.ReactNode }) => open ? <div>{children}</div> : null }));
import MobileProfileSheet from "./MobileProfileSheet";
afterEach(() => { cleanup(); state.push.mockReset(); state.role = "ADMIN"; });

describe("mobile profile navigation", () => {
  it("opens the connection window and closes the profile sheet", () => {
    const close = vi.fn(), open = vi.fn();
    render(<MobileProfileSheet open onClose={close} onOpenConnection={open} />);
    fireEvent.click(screen.getByRole("button", { name: /VPN · Надёжное соединение/ }));
    expect(close).toHaveBeenCalledOnce(); expect(open).toHaveBeenCalledOnce();
  });
  it("shows the administrator entry near the top and navigates only for ADMIN", () => {
    const close = vi.fn(); render(<MobileProfileSheet open onClose={close} onOpenConnection={vi.fn()} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons[1].textContent).toContain("Панель администратора");
    fireEvent.click(screen.getByRole("button", { name: /Панель администратора/ }));
    expect(state.push).toHaveBeenCalledWith("/admin"); expect(close).toHaveBeenCalledOnce();
  });
  it("explains a missing role without exposing an admin link", () => {
    state.role = ""; render(<MobileProfileSheet open onClose={vi.fn()} />);
    expect(screen.getByRole("status").textContent).toContain("Не удалось определить роль");
    expect(screen.queryByRole("button", { name: /Панель администратора/ })).toBeNull();
  });
  it("does not show the administrator entry to a non-admin", () => {
    state.role = "USER"; render(<MobileProfileSheet open onClose={vi.fn()} onOpenConnection={vi.fn()} />);
    expect(screen.queryByRole("button", { name: /Панель администратора/ })).toBeNull();
  });
});
