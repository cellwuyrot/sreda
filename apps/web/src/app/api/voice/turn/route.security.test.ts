import { afterEach, expect, it, vi } from "vitest";
vi.mock("next-auth", () => ({ getServerSession: vi.fn().mockResolvedValue({ user: { id: "u" } }) }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
import { getServerSession } from "next-auth";
import { GET } from "./route";
afterEach(() => vi.unstubAllEnvs());
it("returns expiring per-user credentials without inventing a TLS listener", async () => {
  vi.stubEnv("TURN_URL", "turn:relay.example:3478?transport=udp,turns:relay.example:5349?transport=tcp");
  vi.stubEnv("TURN_AUTH_SECRET", "test-secret");
  const response = await GET(), data = await response.json();
  expect(response.headers.get("cache-control")).toBe("no-store");
  const turn = data.iceServers[2];
  expect(turn.urls).toEqual(["turn:relay.example:3478?transport=udp", "turns:relay.example:5349?transport=tcp"]);
  expect(turn.username).toMatch(/^\d+:u$/);
  expect(data.expiresAt).toBeGreaterThan(Date.now() / 1000);
});
it("does not disclose credentials to unauthenticated clients", async () => {
  vi.mocked(getServerSession).mockResolvedValueOnce(null);
  expect((await GET()).status).toBe(401);
});
