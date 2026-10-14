import { generateKeyPairSync, randomBytes } from "node:crypto";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
if (existsSync("secrets/jwks.json") || existsSync("secrets/env.generated"))
  throw new Error(
    "Keys already exist. Do not overwrite or regenerate them during deployment.",
  );
mkdirSync("secrets", { recursive: true, mode: 0o700 });
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const jwk = {
  ...privateKey.export({ format: "jwk" }),
  kid: randomBytes(16).toString("hex"),
  use: "sig",
  alg: "RS256",
};
// wx protects existing keys and issued tokens against accidental overwrite.
writeFileSync("secrets/jwks.json", JSON.stringify({ keys: [jwk] }), {
  mode: 0o600,
  flag: "wx",
});
writeFileSync(
  "secrets/env.generated",
  `TZ_ID_JWKS_FILE=/var/www/trioz/apps/id/secrets/jwks.json
TZ_ID_STORAGE_KEY=${randomBytes(32).toString("base64")}
TZ_ID_COOKIE_KEYS=${randomBytes(48).toString("base64url")}
`,
  { mode: 0o600, flag: "wx" },
);
console.log(
  "Keys generated in secrets/ (600). Copy configuration privately; no secrets printed. Do not commit these files.",
);
