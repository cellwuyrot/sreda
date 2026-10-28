import { createHash } from "node:crypto";
import { validateClient, type ClientInput } from "./tzIdClients";
export type ClientMetadata = {
  client_id?: string; client_secret?: string; client_name?: string;
  redirect_uris: string[]; token_endpoint_auth_method: string;
  scope?: string; grant_types?: string[]; [key: string]: unknown;
};
export function clientRevision(row: { name: string; metadata: string; enabled: boolean }) {
  return createHash("sha256").update(JSON.stringify([row.name, row.metadata, row.enabled])).digest("hex");
}
/** Only editable fields are accepted. Identity, secret, authentication method and unknown provider fields survive unchanged. */
export function editClientMetadata(meta: ClientMetadata, input: ClientInput) {
  const config = validateClient({ ...input, publicClient: meta.token_endpoint_auth_method === "none" });
  const scopes = ["openid", "profile", "email", ...(config.offlineAccess ? ["offline_access"] : []), ...config.apiScopes];
  const oldScopes = (meta.scope || "openid profile email").split(" ");
  const revoke = oldScopes.some(s => !scopes.includes(s)) || JSON.stringify(meta.redirect_uris) !== JSON.stringify(config.redirectUris);
  return {
    name: config.name, revoke,
    metadata: { ...meta, client_name: config.name, redirect_uris: config.redirectUris,
      scope: scopes.join(" "), grant_types: config.offlineAccess ? ["authorization_code", "refresh_token"] : ["authorization_code"] },
  };
}
