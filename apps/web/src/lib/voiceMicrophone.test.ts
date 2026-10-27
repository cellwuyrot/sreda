import { describe, expect, it, vi } from "vitest";
import { captureOptionalMicrophone, ensureVoiceReceiver } from "./voiceMicrophone";
const constraints = [{ audio: true }, { audio: { channelCount: 1 } }];
describe("listener-only voice", () => {
  it.each(["NotFoundError", "NotAllowedError", "NotReadableError", "OverconstrainedError"])("allows listening after %s", async name => {
    const capture = vi.fn().mockRejectedValue(new DOMException("unavailable", name));
    expect(await captureOptionalMicrophone(capture, constraints)).toBeNull();
    expect(capture).toHaveBeenCalledTimes(2);
  });
  it("retries compatible constraints and returns the acquired stream", async () => {
    const stream = {} as MediaStream;
    const capture = vi.fn().mockRejectedValueOnce(new DOMException("constraints", "OverconstrainedError")).mockResolvedValueOnce(stream);
    expect(await captureOptionalMicrophone(capture, constraints)).toBe(stream);
  });
  it("does not hide unexpected capture exceptions", async () => {
    await expect(captureOptionalMicrophone(vi.fn().mockRejectedValue(new TypeError("bug")), constraints)).rejects.toThrow("bug");
  });
  it("adds a receive-only audio transceiver without a microphone", () => {
    const pc = { addTransceiver: vi.fn() };
    ensureVoiceReceiver(pc as unknown as RTCPeerConnection, null);
    expect(pc.addTransceiver).toHaveBeenCalledWith("audio", { direction: "recvonly" });
  });
  it("does not add a second audio transceiver with a microphone", () => {
    const pc = { addTransceiver: vi.fn() };
    ensureVoiceReceiver(pc as unknown as RTCPeerConnection, { getAudioTracks: () => [{}] } as MediaStream);
    expect(pc.addTransceiver).not.toHaveBeenCalled();
  });
});
