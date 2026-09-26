import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import VoicePlayer from "./VoicePlayer";

describe("VoicePlayer", () => {
  const OriginalAudio = globalThis.Audio;

  beforeEach(() => {
    vi.restoreAllMocks();
    globalThis.URL.createObjectURL = vi.fn(() => "blob:voice-test");
    globalThis.URL.revokeObjectURL = vi.fn();
  });

  afterEach(() => {
    globalThis.Audio = OriginalAudio;
  });

  it("does not create or fetch audio while scrolling/mounting", () => {
    const audioSpy = vi.fn();
    class MockAudio {
      preload = "";
      volume = 1;
      muted = false;
      paused = true;
      duration = 10;
      currentTime = 0;
      onloadedmetadata = null;
      ontimeupdate = null;
      onended = null;
      onerror = null;
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      removeAttribute = vi.fn();
      load = vi.fn();
      constructor(url?: string) {
        audioSpy(url);
      }
    }
    globalThis.Audio = MockAudio as unknown as typeof Audio;
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    render(<VoicePlayer url="/uploads/voice/test.webm" duration={12} />);

    expect(audioSpy).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads the media only after Play is pressed", async () => {
    const audioSpy = vi.fn();
    class MockAudio {
      preload = "";
      volume = 1;
      muted = false;
      paused = true;
      duration = 10;
      currentTime = 0;
      onloadedmetadata = null;
      ontimeupdate = null;
      onended = null;
      onerror = null;
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      removeAttribute = vi.fn();
      load = vi.fn();
      constructor(url?: string) {
        audioSpy(url);
      }
    }
    globalThis.Audio = MockAudio as unknown as typeof Audio;

    render(<VoicePlayer url="/uploads/voice/test.webm" duration={12} />);
    fireEvent.click(screen.getAllByRole("button")[0]);

    await waitFor(() => expect(audioSpy).toHaveBeenCalledTimes(1));
  });

  it("does not start encrypted download until Play is pressed", async () => {
    const audioSpy = vi.fn();
    class MockAudio {
      preload = "";
      volume = 1;
      muted = false;
      paused = true;
      duration = 10;
      currentTime = 0;
      onloadedmetadata = null;
      ontimeupdate = null;
      onended = null;
      onerror = null;
      pause = vi.fn();
      play = vi.fn().mockResolvedValue(undefined);
      removeAttribute = vi.fn();
      load = vi.fn();
      constructor(url?: string) {
        audioSpy(url);
      }
    }
    globalThis.Audio = MockAudio as unknown as typeof Audio;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    );
    const decrypt = vi.fn().mockResolvedValue(new ArrayBuffer(3));

    render(
      <VoicePlayer
        url="/uploads/voice/test.enc"
        duration={12}
        e2eeIv="test-iv"
        e2eeDecrypt={decrypt}
      />,
    );

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(decrypt).not.toHaveBeenCalled();

    fireEvent.click(screen.getAllByRole("button")[0]);

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(decrypt).toHaveBeenCalledTimes(1));
    expect(audioSpy).toHaveBeenCalledTimes(1);
  });
});
