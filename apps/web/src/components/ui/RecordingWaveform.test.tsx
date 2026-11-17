// @vitest-environment jsdom
import { fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import RecordingWaveform from "./RecordingWaveform";

describe("live recording waveform", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
  it("uses the existing stream and releases analyser and audio context", async () => {
    const disconnectSource = vi.fn(), disconnectAnalyser = vi.fn();
    const resume = vi.fn().mockResolvedValue(undefined), suspend = vi.fn().mockResolvedValue(undefined), close = vi.fn().mockResolvedValue(undefined);
    const sample = vi.fn();
    const analyser = { fftSize: 0, frequencyBinCount: 32, getByteFrequencyData: sample, disconnect: disconnectAnalyser };
    const createSource = vi.fn(() => ({ connect: vi.fn(), disconnect: disconnectSource }));
    class FakeAudioContext { createAnalyser() { return analyser; } createMediaStreamSource = createSource; resume = resume; suspend = suspend; close = close; }
    vi.stubGlobal("AudioContext", FakeAudioContext);
    vi.spyOn(document, "hasFocus").mockReturnValue(true);
    const stream = {} as MediaStream;
    const view = render(<RecordingWaveform stream={stream} />);
    await waitFor(() => expect(createSource).toHaveBeenCalledWith(stream));
    expect(sample).toHaveBeenCalled();
    fireEvent.blur(window);
    await waitFor(() => expect(suspend).toHaveBeenCalled());
    view.unmount();
    expect(disconnectSource).toHaveBeenCalledOnce(); expect(disconnectAnalyser).toHaveBeenCalledOnce(); expect(close).toHaveBeenCalledOnce();
  });
  it("does not disrupt recording when audio analysis is unavailable", () => {
    class BrokenAudioContext { constructor() { throw new Error("unavailable"); } }
    vi.stubGlobal("AudioContext", BrokenAudioContext);
    const view = render(<RecordingWaveform stream={{} as MediaStream} />);
    expect(view.container).toBeEmptyDOMElement();
  });
});
