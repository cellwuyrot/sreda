import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const turnUrl = process.env.TURN_URL;
  const turnUsername = process.env.TURN_USERNAME;
  const turnCredential = process.env.TURN_CREDENTIAL;

  const iceServers: RTCIceServer[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];

  if (turnUrl && turnUsername && turnCredential) {
    // Parse host:port from TURN URL (e.g. "turn:host:3478" → "host:3478")
    const hostPort = turnUrl.replace(/^(turn|turns):/, "").replace(/^\/\//, "");

    // Add TURN with multiple transports for maximum connectivity
    iceServers.push(
      { urls: `turn:${hostPort}?transport=udp`, username: turnUsername, credential: turnCredential },
      { urls: `turn:${hostPort}?transport=tcp`, username: turnUsername, credential: turnCredential },
      { urls: `turns:${hostPort}?transport=tcp`, username: turnUsername, credential: turnCredential },
    );
  }

  return NextResponse.json({ iceServers });
}
