import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VoiceRecorder from "./VoiceRecorder";

let active: MockRecorder;
class MockRecorder {
  state = "inactive";
  mimeType = "audio/webm;codecs=opus";
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  static isTypeSupported(type: string) { return type.startsWith("audio/webm"); }
  constructor() { active = this; }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({ data: new Blob(["test"]) });
    this.onstop?.();
  }
}
let trackStop: ReturnType<typeof vi.fn>;
beforeEach(() => {
  trackStop = vi.fn();
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: vi.fn(() => "blob:voice"), revokeObjectURL: vi.fn() }));
  vi.stubGlobal("MediaRecorder", MockRecorder);
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] }) } });
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
describe("VoiceRecorder", () => {
  it("does not send the final recorder chunk after cancellation", async () => {
    const send = vi.fn(); render(<VoiceRecorder onRecorded={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Записать голосовое сообщение" }));
    await screen.findByRole("button", { name: "Отменить запись" });
    fireEvent.click(screen.getByRole("button", { name: "Отменить запись" }));
    expect(send).not.toHaveBeenCalled(); expect(trackStop).toHaveBeenCalledOnce();
  });
  it("sends an actual recording with a normalized MIME type", async () => {
    let now = 10000; vi.spyOn(Date, "now").mockImplementation(() => now);
    const send = vi.fn(); render(<VoiceRecorder onRecorded={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Записать голосовое сообщение" }));
    await screen.findByRole("button", { name: "Остановить запись" });
    now += 2000;
    fireEvent.click(screen.getByRole("button", { name: "Остановить запись" }));
    expect(send).not.toHaveBeenCalled();
    expect(screen.getByLabelText("Прослушать голосовое сообщение")).toHaveAttribute("src", "blob:voice");
    fireEvent.click(screen.getByRole("button", { name: "Отправить" }));
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:voice");
    expect(send).toHaveBeenCalledOnce(); expect(send.mock.calls[0][0].type).toBe("audio/webm");
    expect(send.mock.calls[0][1]).toBe(2); expect(trackStop).toHaveBeenCalledOnce();
  });
  it("stops the microphone without sending when unmounted", async () => {
    const send = vi.fn(); const view = render(<VoiceRecorder onRecorded={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Записать голосовое сообщение" }));
    await screen.findByRole("button", { name: "Отменить запись" });
    view.unmount(); expect(send).not.toHaveBeenCalled(); expect(trackStop).toHaveBeenCalledOnce();
  });
  it("stops a microphone granted after the component has unmounted", async () => {
    let resolve!: (v: unknown) => void;
    vi.mocked(navigator.mediaDevices.getUserMedia).mockReturnValue(new Promise(r => { resolve = r; }) as Promise<MediaStream>);
    const send = vi.fn(); const view = render(<VoiceRecorder onRecorded={send} />);
    fireEvent.click(screen.getByRole("button", { name: "Записать голосовое сообщение" }));
    view.unmount(); resolve({ getTracks: () => [{ stop: trackStop }] });
    await waitFor(() => expect(trackStop).toHaveBeenCalledOnce()); expect(send).not.toHaveBeenCalled();
  });
});
