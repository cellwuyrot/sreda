import { expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { ephemeralTurnCredential } from "./turnCredentials";
it("issues per-user expiring coturn credentials with bounded lifetime", () => {
  const result = ephemeralTurnCredential("alice", "test-secret", 1_000_000, 7200);
  expect(result.username).toBe("4600:alice"); expect(result.expiresAt).toBe(4600);
  expect(result.credential).toBe(createHmac("sha1", "test-secret").update("4600:alice").digest("base64"));
});
