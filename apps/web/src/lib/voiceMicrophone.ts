/** Capture failure must not prevent listening. Unknown errors still surface. */
export async function captureOptionalMicrophone(
  capture: (constraints: MediaStreamConstraints) => Promise<MediaStream>,
  constraints: MediaStreamConstraints[],
): Promise<MediaStream | null> {
  let lastError: unknown;
  for (const constraint of constraints) {
    try { return await capture(constraint); }
    catch (error) { lastError = error; }
  }
  const name = (lastError as { name?: string } | null)?.name;
  if (name && ["NotFoundError", "DevicesNotFoundError", "NotAllowedError", "PermissionDeniedError", "NotReadableError", "TrackStartError", "OverconstrainedError"].includes(name)) {
    return null;
  }
  throw lastError;
}

/** An offer without audio m-lines cannot receive the other participant's mic. */
export function ensureVoiceReceiver(pc: RTCPeerConnection, stream: MediaStream | null) {
  if (!stream?.getAudioTracks().length) pc.addTransceiver("audio", { direction: "recvonly" });
}
