import { ephemeralTurnCredential } from "@/lib/turnCredentials";
import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const turnUrl = process.env.TURN_URL;
  const rest = process.env.TURN_AUTH_SECRET ? ephemeralTurnCredential(session.user.id, process.env.TURN_AUTH_SECRET) : null;
  const turnUsername = rest?.username ?? process.env.TURN_USERNAME;
  const turnCredential = rest?.credential ?? process.env.TURN_CREDENTIAL;

  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  if (turnUrl && turnUsername && turnCredential) {
    // Preserve an explicit scheme/port/transport. TLS requires an actual
    // coturn TLS listener and certificate; never synthesize turns: on 3478.
    const urls = turnUrl.split(",").map(url => url.trim()).filter(url => /^turns?:[^\s?#]+(?:\?transport=(?:udp|tcp))?$/.test(url));
    if (urls.length) iceServers.push({ urls, username: turnUsername, credential: turnCredential });
  }

  return NextResponse.json({ iceServers, expiresAt: rest?.expiresAt ?? null }, { headers: { "Cache-Control": "no-store" } });
}
