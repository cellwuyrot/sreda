import { randomBytes } from "node:crypto";
import prisma from "./prisma";
import { encryptTzData } from "./tzIdCrypto";
export type ClientInput = {
  name: string;
  redirectUris: string[];
  publicClient?: boolean;
  offlineAccess?: boolean;
};
export function validateClient(input: ClientInput) {
  if (
    !input ||
    typeof input.name !== "string" ||
    !input.name.trim() ||
    input.name.length > 100
  )
    throw new Error("Название: 1–100 символов");
  if (
    !Array.isArray(input.redirectUris) ||
    !input.redirectUris.length ||
    input.redirectUris.length > 10
  )
    throw new Error("Укажите 1–10 redirect URI");
  const redirectUris = [
    ...new Set(
      input.redirectUris.map((raw) => {
        if (typeof raw !== "string" || raw.length > 2048)
          throw new Error("Некорректный redirect URI");
        const url = new URL(raw);
        const dev =
          process.env.TZ_ID_DEV_ALLOW_HTTP === "1" &&
          ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
        if (
          (url.protocol !== "https:" && !(dev && url.protocol === "http:")) ||
          url.username ||
          url.password ||
          url.hash ||
          raw.includes("*") ||
          url.href !== raw
        )
          throw new Error(
            "Требуется точный HTTPS redirect URI без wildcard и fragment",
          );
        return raw;
      }),
    ),
  ];
  return {
    name: input.name.trim(),
    redirectUris,
    publicClient: input.publicClient === true,
    offlineAccess: input.offlineAccess === true,
  };
}
export async function registerClient(input: ClientInput) {
  const config = validateClient(input);
  const id = `tz_${randomBytes(16).toString("hex")}`;
  const secret = config.publicClient
    ? undefined
    : randomBytes(32).toString("base64url");
  const metadata = {
    client_id: id,
    client_name: config.name,
    redirect_uris: config.redirectUris,
    response_types: ["code"],
    grant_types: config.offlineAccess
      ? ["authorization_code", "refresh_token"]
      : ["authorization_code"],
    token_endpoint_auth_method: config.publicClient
      ? "none"
      : "client_secret_basic",
    ...(secret ? { client_secret: secret } : {}),
    scope: `openid profile email${config.offlineAccess ? " offline_access" : ""}`,
    id_token_signed_response_alg: "RS256",
  };
  await prisma.tzIdClient.create({
    data: { id, name: config.name, metadata: encryptTzData(metadata) },
  });
  return {
    clientId: id,
    ...(secret ? { clientSecret: secret } : {}),
    issuer: "https://id.trioz.ru",
  };
}
