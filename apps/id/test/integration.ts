import "dotenv/config";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { spawn } from "node:child_process";
import { randomBytes, createHash, generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { registerClient } from "../../web/src/lib/tzIdClients";
import { liveSession, revokeSessions } from "../../web/src/lib/tzIdSessions";
import { jwtVerify, createRemoteJWKSet } from "jose";
// Dedicated scratch DB only. Never run against production.
const testDatabase = new URL(
  process.env.DATABASE_URL || "postgresql://invalid/invalid",
);
if (
  testDatabase.pathname !== "/tzid_test" ||
  !["127.0.0.1", "localhost"].includes(testDatabase.hostname)
)
  throw new Error(
    "Dedicated local tzid_test database required; these tests destroy fixtures",
  );
process.env.TZ_ID_DEV_ALLOW_HTTP = "1";
process.env.TZ_ID_STORAGE_KEY = randomBytes(32).toString("base64");
const db = new PrismaClient();
const issuer = "http://127.0.0.1:3100",
  redirect = "http://127.0.0.1:3200/callback";
const dir = process.env.TZ_ID_TEST_DIR || "/tmp/trioz-tzid-test";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
writeFileSync(
  `${dir}/jwks.json`,
  JSON.stringify({
    keys: [
      {
        ...privateKey.export({ format: "jwk" }),
        kid: "test-key",
        alg: "RS256",
        use: "sig",
      },
    ],
  }),
  { mode: 0o600 },
);
const require = createRequire(import.meta.url);
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
const password = randomBytes(15).toString("base64url");
const suffix = randomBytes(4).toString("hex");
const user = await db.user.create({
  data: {
    email: `tzid-${suffix}@example.invalid`,
    username: `tzid_${suffix}`,
    name: "TZ ID Test",
    password: await bcrypt.hash(password, 10),
    emailVerified: true,
  },
});
const client = await registerClient({
  name: "External test app",
  redirectUris: [redirect],
  publicClient: true,
  offlineAccess: true,
});
const idproc = spawn(
  process.execPath,
  [
    "../../node_modules/tsx/dist/cli.mjs",
    "--tsconfig",
    "../web/tsconfig.json",
    "src/server.ts",
  ],
  {
    cwd: process.cwd(),
    env: {
      ...process.env,
      NODE_ENV: "test",
      PORT: "3100",
      TZ_ID_ISSUER: issuer,
      TZ_ID_WEB_ORIGIN: "http://127.0.0.1:3300",
      TZ_ID_JWKS_FILE: `${dir}/jwks.json`,
      TZ_ID_COOKIE_KEYS: randomBytes(40).toString("hex"),
    },
    stdio: ["ignore", "pipe", "pipe"],
  },
);
const logs: string[] = [];
idproc.stdout.on("data", (d) => logs.push(d.toString()));
idproc.stderr.on("data", (d) => logs.push(d.toString()));
const callback = createServer((_req, res) => {
  res.setHeader("Content-Type", "text/html");
  res.end("<h1>External app callback</h1>");
});
await new Promise<void>((resolve) =>
  callback.listen(3200, "127.0.0.1", resolve),
);
let browser: any;
function ok(label: string) {
  console.log(`PASS ${label}`);
}
async function exchange(code: string, verifier: string) {
  return fetch(`${issuer}/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: client.clientId,
      code,
      redirect_uri: redirect,
      code_verifier: verifier,
    }),
  });
}
try {
  let ready = false;
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${issuer}/health`)).ok) {
        ready = true;
        break;
      }
    } catch {}
    await new Promise((r) => setTimeout(r, 100));
  }
  if (!ready) {
    writeFileSync(`${dir}/startup.log`, logs.join(""), { mode: 0o600 });
    throw new Error("ID server did not start; inspect private startup log");
  }
  const discovery = await (
    await fetch(`${issuer}/.well-known/openid-configuration`)
  ).json();
  assert.equal(discovery.issuer, issuer);
  assert.ok(discovery.code_challenge_methods_supported.includes("S256"));
  ok("discovery, issuer and S256");
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/local/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  async function authorize(
    context: any,
    scope = "openid profile email offline_access",
  ) {
    const verifier = randomBytes(32).toString("base64url"),
      nonce = randomBytes(16).toString("hex"),
      state = randomBytes(16).toString("hex");
    const page = await context.newPage();
    const params = new URLSearchParams({
      client_id: client.clientId,
      redirect_uri: redirect,
      response_type: "code",
      scope,
      code_challenge: createHash("sha256").update(verifier).digest("base64url"),
      code_challenge_method: "S256",
      state,
      nonce,
      prompt: "consent",
    });
    await page.goto(`${issuer}/authorize?${params}`);
    if (await page.locator("#email").count()) {
      await page.screenshot({
        path: `${dir}/login-${(page.viewportSize()?.width || 0) >= 768 ? "desktop" : "mobile"}.png`,
      });
      const csrfTest = await page.evaluate(async () => {
        const r = await fetch(location.href, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: "email=bad&password=bad&csrf=bad",
        });
        return r.status;
      });
      assert.equal(csrfTest, 403);
      await page.locator("#email").fill(user.email);
      await page.locator("#password").fill(password);
      await page
        .getByRole("button", { name: "Войти через TZ ID", exact: true })
        .click();
    }
    await page.waitForTimeout(600);
    writeFileSync(`${dir}/page.txt`, await page.locator("body").innerText(), {
      mode: 0o600,
    });
    writeFileSync(`${dir}/startup.log`, logs.join(""), { mode: 0o600 });
    await page
      .getByRole("button", { name: "Разрешить доступ", exact: true })
      .waitFor();
    if (!scope.includes("offline_access")) {
      /* no refresh requested */
    }
    await page.screenshot({
      path: `${dir}/consent-${(page.viewportSize()?.width || 0) >= 768 ? "desktop" : "mobile"}.png`,
    });
    await page
      .getByRole("button", { name: "Разрешить доступ", exact: true })
      .click();
    await page.waitForTimeout(500);
    writeFileSync(
      `${dir}/after-consent.txt`,
      await page.locator("body").innerText(),
      { mode: 0o600 },
    );
    writeFileSync(`${dir}/startup.log`, logs.join(""), { mode: 0o600 });
    await page.waitForURL(
      (url) =>
        url.origin === "http://127.0.0.1:3200" && url.pathname === "/callback",
    );
    const final = new URL(page.url());
    assert.equal(final.searchParams.get("state"), state);
    assert.ok(final.searchParams.get("code"));
    await page.close();
    return { code: final.searchParams.get("code")!, verifier, nonce };
  }
  const context = await browser.newContext({
    viewport: { width: 1100, height: 800 },
  });
  const flow = await authorize(context);
  const beforeUsers = await db.user.count(),
    beforePeers = await db.vpnPeer.count();
  const tokenResponse = await exchange(flow.code, flow.verifier);
  if (tokenResponse.status !== 200) {
    writeFileSync(`${dir}/startup.log`, logs.join(""), { mode: 0o600 });
    console.log("Token exchange failed; inspect private server log.");
  }
  assert.equal(tokenResponse.status, 200);
  const token = await tokenResponse.json();
  assert.ok(token.refresh_token);
  const verified = await jwtVerify(
    token.id_token,
    createRemoteJWKSet(new URL(`${issuer}/jwks`)),
    { issuer, audience: client.clientId },
  );
  assert.equal(verified.payload.sub, user.id);
  assert.equal(verified.payload.nonce, flow.nonce);
  assert.equal(verified.payload.role, undefined);
  ok(
    "external app Code + PKCE, signed ID token, stable sub, nonce, minimal claims",
  );
  const profile = await (
    await fetch(`${issuer}/userinfo`, {
      headers: { Authorization: `Bearer ${token.access_token}` },
    })
  ).json();
  assert.equal(profile.sub, user.id);
  assert.equal(profile.email, user.email);
  assert.equal(profile.email_verified, true);
  assert.equal(profile.preferred_username, user.username);
  assert.equal(await db.user.count(), beforeUsers);
  assert.equal(await db.vpnPeer.count(), beforePeers);
  ok("userinfo: existing account, no duplicate User or VPN peer");
  const cipher = await db.tzIdArtifact.findFirst({
    where: { model: "AccessToken" },
  });
  assert.ok(cipher);
  assert.ok(!cipher.payload.includes(user.email));
  assert.ok(!cipher.payload.includes(token.access_token));
  assert.ok(!cipher.key.includes(token.access_token));
  ok("encrypted artifacts, hashed identifiers");
  async function refresh(value: string) {
    return fetch(`${issuer}/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: client.clientId,
        refresh_token: value,
      }),
    });
  }
  const rotation = await refresh(token.refresh_token);
  assert.equal(rotation.status, 200);
  const rotated = await rotation.json();
  assert.notEqual(rotated.refresh_token, token.refresh_token);
  ok("refresh token rotation");
  assert.notEqual((await refresh(token.refresh_token)).status, 200);
  ok("refresh token reuse denied");
  assert.notEqual((await exchange(flow.code, flow.verifier)).status, 200);
  ok("authorization code replay denied");
  // Replay revokes the grant. Start a fresh authorization before later tests.
  const next = await authorize(context, "openid profile email");
  const nextToken = await (await exchange(next.code, next.verifier)).json();
  assert.ok(nextToken.access_token);
  const auth = await db.tzIdAuthorization.findFirst({
    where: { userId: user.id, revokedAt: null },
    include: { session: true },
  });
  assert.ok(auth);
  assert.equal(await liveSession(user.id, auth.sessionId), true);
  await revokeSessions(user.id, auth.sessionId);
  assert.equal(await liveSession(user.id, auth.sessionId), false);
  assert.equal(
    (
      await fetch(`${issuer}/userinfo`, {
        headers: { Authorization: `Bearer ${nextToken.access_token}` },
      })
    ).status,
    401,
  );
  ok("server session revocation immediately denies API access");
  const context2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const mobile = await context2.newPage();
  const verifier = randomBytes(32).toString("base64url");
  const url = new URL(`${issuer}/authorize`);
  url.search = new URLSearchParams({
    client_id: client.clientId,
    redirect_uri: redirect,
    response_type: "code",
    scope: "openid",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  }).toString();
  await mobile.goto(url.href);
  await mobile.locator("#email").waitFor();
  await mobile.screenshot({ path: `${dir}/login-mobile.png` });
  assert.equal(
    await mobile.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  ok("responsive mobile login and CSRF rejection");
  await mobile.close();
  const badRedirect = new URL(url);
  badRedirect.searchParams.set(
    "redirect_uri",
    "https://attacker.invalid/callback",
  );
  const rejected = await fetch(badRedirect, { redirect: "manual" });
  assert.equal(rejected.status, 400);
  ok("unregistered redirect denied");
  const missingPkce = new URL(url);
  missingPkce.searchParams.delete("code_challenge");
  missingPkce.searchParams.delete("code_challenge_method");
  const noPkce = await fetch(missingPkce, { redirect: "manual" });
  assert.ok(
    noPkce.status === 400 ||
      String(noPkce.headers.get("location")).includes("error="),
  );
  ok("missing PKCE denied");
  const minimal = await authorize(context2, "openid");
  const minimalToken = await (
    await exchange(minimal.code, minimal.verifier)
  ).json();
  const minimalProfile = await (
    await fetch(`${issuer}/userinfo`, {
      headers: { Authorization: `Bearer ${minimalToken.access_token}` },
    })
  ).json();
  assert.equal(minimalProfile.sub, user.id);
  assert.equal(minimalProfile.email, undefined);
  assert.equal(minimalProfile.name, undefined);
  ok("scope minimization: openid does not expose email/profile");
  async function introspect(value: string) {
    return fetch(`${issuer}/introspect`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: client.clientId, token: value }),
    });
  }
  const activeInspection = await introspect(minimalToken.access_token);
  assert.equal(activeInspection.status, 200);
  assert.equal((await activeInspection.json()).active, true);
  ok("introspection of active token");

  const pkceFailure = await authorize(context2, "openid");
  assert.notEqual(
    (await exchange(pkceFailure.code, randomBytes(32).toString("base64url")))
      .status,
    200,
  );
  ok("wrong PKCE verifier denied");
  const logoutPage = await context2.newPage();
  await logoutPage.goto(
    `${discovery.end_session_endpoint}?id_token_hint=${encodeURIComponent(minimalToken.id_token)}`,
  );
  await logoutPage
    .getByRole("button", { name: "Выйти из TZ ID", exact: true })
    .click();
  await logoutPage.getByRole("heading", { name: "Сеанс завершён" }).waitFor();
  assert.equal(
    (
      await fetch(`${issuer}/userinfo`, {
        headers: { Authorization: `Bearer ${minimalToken.access_token}` },
      })
    ).status,
    401,
  );
  ok("RP-initiated logout revokes linked session access");
  const revokeFlow = await authorize(context2, "openid");
  const revokeToken = await (
    await exchange(revokeFlow.code, revokeFlow.verifier)
  ).json();
  assert.equal(
    (
      await fetch(`${issuer}/userinfo`, {
        headers: { Authorization: `Bearer ${revokeToken.access_token}` },
      })
    ).status,
    200,
  );
  const revokeResponse = await fetch(`${issuer}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: client.clientId,
      token: revokeToken.access_token,
    }),
  });
  assert.equal(revokeResponse.status, 200);
  assert.equal(
    (
      await fetch(`${issuer}/userinfo`, {
        headers: { Authorization: `Bearer ${revokeToken.access_token}` },
      })
    ).status,
    401,
  );
  assert.equal(
    (await (await introspect(revokeToken.access_token)).json()).active,
    false,
  );
  ok("revocation endpoint denies token and introspection reports inactive");

  await db.tzIdClient.update({
    where: { id: client.clientId },
    data: { enabled: false },
  });
  assert.equal((await fetch(url, { redirect: "manual" })).status, 400);
  ok("disabled client denied");
  const local = await db.userSession.create({
    data: {
      userId: user.id,
      token: `test-${suffix}`,
      expiresAt: new Date(Date.now() + 60000),
    },
  });
  assert.equal(await liveSession(user.id, local.id), true);
  await db.user.update({
    where: { id: user.id },
    data: { passwordChangedAt: new Date() },
  });
  assert.equal(await liveSession(user.id, local.id), false);
  ok("password change invalidates existing sessions");
  console.log("Integration suite passed.");
} finally {
  if (browser) await browser.close();
  idproc.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 300));
  callback.close();
  await db.tzIdArtifact.deleteMany();
  await db.tzIdClient.delete({ where: { id: client.clientId } });
  await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
  process.exitCode = process.exitCode || 0;
}
