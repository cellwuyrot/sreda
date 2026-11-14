import { NextResponse } from "next/server";
import { isValidSyncToken, loadTrustTunnelSettings, parseSyncAck, sealDesiredState } from "@/lib/trustTunnelAccess";
import { computeDesiredEntries, issuedKeys, recordAck, recordIssued } from "@/lib/trustTunnelSync";

const NO_STORE = { "Cache-Control": "no-store, private" };

/**
 * TRUSTTUNNEL-SUBSCRIBERS: pull endpoint for the endpoint-host sync agent.
 *
 * Request: `Authorization: Bearer <agent token>`, optional JSON body
 * `{ "ack": { serial, ok, digest, error } }` for the previously applied state.
 * Response: `{ sealed }` — the complete desired credential snapshot encrypted
 * with TRIOZ_TT_SYNC_KEY. Any failure returns 503 so the agent keeps its last
 * applied state instead of revoking everybody.
 */
export async function POST(req: Request) {
  let settings;
  try { settings = loadTrustTunnelSettings(); } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
  if (!isValidSyncToken(settings, req.headers.get("authorization")))
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  try {
    const now = new Date();
    const text = await req.text();
    if (text.length > 4096) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
    let ackAccepted: boolean | null = null;
    if (text.trim()) {
      let body: unknown;
      try { body = JSON.parse(text); } catch { return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE }); }
      const raw = body && typeof body === "object" && !Array.isArray(body) ? (body as { ack?: unknown }).ack : undefined;
      if (raw !== undefined && raw !== null) {
        const ack = parseSyncAck(raw);
        if (!ack) return NextResponse.json({ error: "bad_request" }, { status: 400, headers: NO_STORE });
        ackAccepted = await recordAck(ack, now);
      }
    }
    const entries = await computeDesiredEntries(now);
    const state = sealDesiredState(settings, entries, now);
    await recordIssued({ serial: state.serial, digest: state.digest, keys: issuedKeys(settings, entries) });
    return NextResponse.json({ sealed: state.sealed, ackAccepted }, { headers: NO_STORE });
  } catch {
    return NextResponse.json({ error: "unavailable" }, { status: 503, headers: NO_STORE });
  }
}
