/**
 * SDP utilities for Opus quality tuning.
 *
 * What we change:
 *  - useinbandfec=1  : Opus Forward Error Correction — recovers from packet loss
 *  - maxaveragebitrate: raise from ~32 kbps default to 256 kbps
 *  - stereo=0        : mono is fine for voice, saves bandwidth
 *  - b=AS:256        : session-level bandwidth hint
 */

const TARGET_BITRATE = 256_000; // bps

export function patchOpusSDP(sdp: string): string {
  // Find Opus payload type number (always 48000/2 channels)
  const ptMatch = sdp.match(/a=rtpmap:(\d+) opus\/48000\/2/);
  if (!ptMatch) return sdp;  // No Opus in offer — leave unchanged
  const pt = ptMatch[1];

  const params = `useinbandfec=1;stereo=0;maxaveragebitrate=${TARGET_BITRATE}`;

  // Case 1 — existing fmtp line for this PT
  const fmtpRe = new RegExp(`(a=fmtp:${pt} )(.*)`);
  if (fmtpRe.test(sdp)) {
    sdp = sdp.replace(fmtpRe, (_, prefix, existing) => {
      // Merge params without duplicating keys
      const existing_parts = existing.split(';').filter(Boolean);
      const extra = params.split(';').filter(p => {
        const key = p.split('=')[0];
        return !existing_parts.some((e: string) => e.startsWith(key));
      });
      return `${prefix}${[...existing_parts, ...extra].join(';')}`;
    });
  } else {
    // Case 2 — no fmtp line yet, add one after the rtpmap
    sdp = sdp.replace(
      `a=rtpmap:${pt} opus/48000/2`,
      `a=rtpmap:${pt} opus/48000/2\r\na=fmtp:${pt} ${params}`
    );
  }

  // Add bandwidth line after each m=audio line (if not already present)
  sdp = sdp.replace(/(m=audio[^\r\n]*\r\n)/g, (match) => {
    if (sdp.indexOf('b=AS:') !== -1) return match;  // already has bandwidth
    return `${match}b=AS:${Math.round(TARGET_BITRATE / 1000)}\r\n`;
  });

  return sdp;
}

/**
 * Apply SDP patch to a peer connection's local description just before sending.
 * Call this after setLocalDescription to intercept the offer/answer.
 */
export async function patchedOffer(pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
  const offer = await pc.createOffer();
  const patched = { ...offer, sdp: patchOpusSDP(offer.sdp ?? '') };
  await pc.setLocalDescription(patched);
  return patched;
}

export async function patchedAnswer(pc: RTCPeerConnection): Promise<RTCSessionDescriptionInit> {
  const answer = await pc.createAnswer();
  const patched = { ...answer, sdp: patchOpusSDP(answer.sdp ?? '') };
  await pc.setLocalDescription(patched);
  return patched;
}
