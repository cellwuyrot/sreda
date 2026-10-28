import { expect, it } from "vitest";
import { editClientMetadata, clientRevision } from "./tzIdClientEdit";
const meta = { client_id: "same-id", client_secret: "private", redirect_uris: ["https://business.trioz.ru/api/auth/tz-id/callback"], scope: "openid profile email roles:read", token_endpoint_auth_method: "client_secret_basic", grant_types: ["authorization_code"], custom: "preserve" };
const input = { name: "Business renamed", redirectUris: meta.redirect_uris, offlineAccess: true, apiScopes: ["roles:read"] };
it("enables refresh for the existing identity and keeps secret/custom fields", () => {
 const result = editClientMetadata(meta, input);
 expect(result.metadata).toMatchObject({ client_id: "same-id", client_secret: "private", custom: "preserve", grant_types: ["authorization_code", "refresh_token"] });
 expect(result.metadata.scope).toContain("offline_access"); expect(result.revoke).toBe(false);
});
it("changing a return address revokes old consent", () => { expect(editClientMetadata(meta, { ...input, redirectUris: ["https://business.trioz.ru/new"] }).revoke).toBe(true); });
it("reducing API permissions revokes old consent", () => { expect(editClientMetadata(meta, { ...input, apiScopes: [] }).revoke).toBe(true); });
it("turning off session renewal revokes old consent and removes refresh grant", () => { const result = editClientMetadata({ ...meta, scope: meta.scope + " offline_access" }, { ...input, offlineAccess: false }); expect(result.revoke).toBe(true); expect(result.metadata.grant_types).toEqual(["authorization_code"]); });
it("does not change a public client's auth method", () => { expect(() => editClientMetadata({ ...meta, token_endpoint_auth_method: "none" }, input)).toThrow(); });
it.each(["http://evil.test/cb", "https://evil.test/*", "https://evil.test/cb#x"])("rejects unsafe callback %s", uri => { expect(() => editClientMetadata(meta, { ...input, redirectUris: [uri] })).toThrow(); });
it("revision changes on metadata/name/status changes without revealing content", () => { const row = { name: "App", metadata: "encrypted", enabled: true }; const rev = clientRevision(row); expect(rev).toMatch(/^[a-f0-9]{64}$/); expect(clientRevision({ ...row, name: "Other" })).not.toBe(rev); expect(clientRevision({ ...row, enabled: false })).not.toBe(rev); });
