// @vitest-environment jsdom
import { act, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useElectronWindowActivity } from "./useElectronWindowActivity";
const bridge = vi.hoisted(() => ({ api: null as null | Record<string, unknown> }));
vi.mock("@/lib/desktop", () => ({ getDesktopApi: () => bridge.api }));
function Status() { return <span>{useElectronWindowActivity() ? "active" : "paused"}</span>; }
describe("window activity gating", () => {
  beforeEach(() => { vi.spyOn(document, "hasFocus").mockReturnValue(true); bridge.api = null; });
  afterEach(() => { bridge.api = null; vi.restoreAllMocks(); });
  it("pauses on DOM blur and resumes on focus", async () => {
    render(<Status />);
    await screen.findByText("active");
    act(() => window.dispatchEvent(new Event("blur")));
    expect(screen.getByText("paused")).toBeInTheDocument();
    act(() => window.dispatchEvent(new Event("focus")));
    expect(screen.getByText("active")).toBeInTheDocument();
  });
  it("tracks native active state and unsubscribes on unmount", async () => {
    let notify!: (active: boolean) => void;
    const unsubscribe = vi.fn();
    bridge.api = { getWindowActive: async () => true, onWindowActiveChange: (cb: typeof notify) => { notify = cb; return unsubscribe; } };
    const view = render(<Status />);
    await screen.findByText("active");
    act(() => notify(false)); expect(screen.getByText("paused")).toBeInTheDocument();
    act(() => notify(true)); expect(screen.getByText("active")).toBeInTheDocument();
    view.unmount(); expect(unsubscribe).toHaveBeenCalledOnce();
  });
  it("does not let a stale initial native query overwrite a later event", async () => {
    let notify!: (active: boolean) => void, resolve!: (value: boolean) => void;
    bridge.api = { getWindowActive: () => new Promise<boolean>(r => { resolve = r; }), onWindowActiveChange: (cb: typeof notify) => { notify = cb; return () => {}; } };
    render(<Status />);
    act(() => notify(false));
    await act(async () => resolve(true));
    await waitFor(() => expect(screen.getByText("paused")).toBeInTheDocument());
  });
  it("uses the hidden-state bridge on older desktop versions", async () => {
    let notify!: (hidden: boolean) => void;
    bridge.api = { getWindowHidden: async () => false, onWindowHiddenChange: (cb: typeof notify) => { notify = cb; return () => {}; } };
    render(<Status />); await screen.findByText("active");
    act(() => notify(true)); expect(screen.getByText("paused")).toBeInTheDocument();
  });
});
