import "dotenv/config";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { randomBytes, generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { registerClient } from "../../web/src/lib/tzIdClients";
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
const db = new PrismaClient(),
  root = resolve("../..");
// This isolated DB is owned by these destructive tests; clear stale encrypted fixtures.
await db.tzIdArtifact.deleteMany();
await db.tzIdClient.deleteMany();
process.env.TZ_ID_DEV_ALLOW_HTTP = "1";
process.env.TZ_ID_STORAGE_KEY = randomBytes(32).toString("base64");
const dir = process.env.TZ_ID_TEST_DIR || "/tmp/trioz-tzid-web-test";
mkdirSync(dir, { recursive: true, mode: 0o700 });
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
writeFileSync(
  `${dir}/jwks.json`,
  JSON.stringify({
    keys: [
      {
        ...privateKey.export({ format: "jwk" }),
        kid: "web-test",
        alg: "RS256",
        use: "sig",
      },
    ],
  }),
  { mode: 0o600 },
);
const suffix = randomBytes(4).toString("hex"),
  password = randomBytes(14).toString("base64url");
const user = await db.user.create({
  data: {
    name: "Тестовый аккаунт",
    username: `web_${suffix}`,
    email: `web-${suffix}@example.invalid`,
    password: await bcrypt.hash(password, 10),
    emailVerified: true,
    role: "ADMIN",
  },
});
const group = await db.group.create({
  data: {
    name: "Preserved test community",
    ownerId: user.id,
    channels: { create: { name: "general" } },
  },
  include: { channels: true },
});
const message = await db.message.create({
  data: {
    userId: user.id,
    channelId: group.channels[0].id,
    content: "Community content must survive account deletion",
  },
});
const client = await registerClient({
  name: "TrioZ (test)",
  redirectUris: ["http://127.0.0.1:3300/api/auth/callback/tz-id"],
  publicClient: false,
});
const env = {
  ...process.env,
  NODE_ENV: "production",
  TZ_ID_ISSUER: "http://127.0.0.1:3100",
  TZ_ID_WEB_ORIGIN: "http://127.0.0.1:3300",
  TZ_ID_JWKS_FILE: `${dir}/jwks.json`,
  TZ_ID_COOKIE_KEYS: randomBytes(40).toString("hex"),
  NEXTAUTH_URL: "http://127.0.0.1:3300",
  NEXTAUTH_SECRET: randomBytes(32).toString("hex"),
  TZ_ID_CLIENT_ID: client.clientId,
  TZ_ID_CLIENT_SECRET: client.clientSecret!,
};
function start(cwd: string, args: string[]) {
  const proc = spawn(
    process.execPath,
    [`${root}/node_modules/tsx/dist/cli.mjs`, ...args],
    {
      cwd,
      env: { ...env, PORT: cwd.endsWith("/id") ? "3100" : "3300" },
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  proc.stdout.on("data", () => {});
  proc.stderr.on("data", () => {});
  return proc;
}
const id = start(`${root}/apps/id`, [
    "--tsconfig",
    "../web/tsconfig.json",
    "src/server.ts",
  ]),
  web = start(`${root}/apps/web`, ["--tsconfig", "tsconfig.json", "server.ts"]);
const require = createRequire(import.meta.url),
  { chromium } = require(process.env.PLAYWRIGHT_MODULE || "playwright");
let browser: any;
try {
  for (const url of [
    "http://127.0.0.1:3100/health",
    "http://127.0.0.1:3300/api/auth/providers",
  ]) {
    let ready = false;
    for (let i = 0; i < 150; i++) {
      try {
        if ((await fetch(url)).ok) {
          ready = true;
          break;
        }
      } catch {}
      await new Promise((r) => setTimeout(r, 200));
    }
    assert.ok(ready, "Service ready");
  }
  browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || "/usr/local/bin/chromium",
    headless: true,
    args: ["--no-sandbox"],
  });
  const context = await browser.newContext({
      viewport: { width: 1280, height: 1000 },
    }),
    page = await context.newPage();
  await page.goto(
    "http://127.0.0.1:3300/auth/signin?callbackUrl=%2Fsettings%3Fsection%3Dtzid",
  );
  await page
    .getByRole("button", { name: "Войти через TZ ID", exact: true })
    .click();
  await page.locator("#email").waitFor();
  await page.locator("#email").fill(user.email);
  await page.locator("#password").fill(password);
  await page
    .getByRole("button", { name: "Войти через TZ ID", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Разрешить доступ", exact: true })
    .click();
  await page.waitForURL(
    (url) => url.port === "3300" && url.pathname === "/settings",
  );
  await page
    .getByRole("heading", { name: "Ваш постоянный идентификатор" })
    .waitFor();
  let session = await page.evaluate(
    async () => await (await fetch("/api/auth/session")).json(),
  );
  assert.equal(session.user.id, user.id);
  assert.equal(session.user.role, "ADMIN");
  assert.ok(session.user.sessionId);
  console.log(
    "PASS first-party NextAuth OIDC login: same User.id, local roles, linked server session",
  );
  await page.evaluate(async () => {
    await fetch("/api/welcome/accept", { method: "POST" });
  });
  await page.reload();
  await page
    .getByRole("heading", { name: "Ваш постоянный идентификатор" })
    .waitFor();
  await page.screenshot({
    path: `${dir}/settings-desktop.png`,
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3300/tz-id");
  await page.getByRole("heading", { name: "Профиль", exact: true }).waitFor();
  await page.getByRole("button", { name: "Адреса", exact: true }).click();
  await page.locator("textarea").fill("Общий контакт из TrioZ");
  await page.getByRole("button", { name: "Сохранить", exact: true }).click();
  await page.getByText("Изменения сохранены", { exact: true }).waitFor();
  assert.equal((await db.user.findUniqueOrThrow({ where: { id: user.id } })).contactAddress, "Общий контакт из TrioZ");
  const hub = await page.evaluate(async () => (await fetch("/api/tz-id/hub")).json());
  assert.equal(hub.profile.id, user.id);
  assert.equal(hub.profile.contactAddress, "Общий контакт из TrioZ");
  assert.equal(hub.twoFactor.enabled, false);
  await page.screenshot({ path: `${dir}/hub-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: `${dir}/hub-mobile.png`, fullPage: true });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.getByRole("button", { name: "Сотрудничество", exact: true }).first().click();
  await page.getByRole("button", { name: "Сотрудничество — заказать услугу TrioZ" }).click();
  await page.getByRole("heading", { name: "Сотрудничество", exact: true }).last().waitFor();
  await page.getByRole("button", { name: "Закрыть", exact: true }).click();
  console.log("PASS TrioZ hub edits shared contact, responsive layout and reuses CooperationButton");
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto("http://127.0.0.1:3300/settings?section=tzid");
  await page.getByRole("button", { name: "Безопасность", exact: true }).click();
  await page.getByRole("heading", { name: "Устройства и сеансы" }).waitFor();
  await page.screenshot({
    path: `${dir}/security-desktop.png`,
    fullPage: true,
  });
  await page.getByRole("button", { name: "Приложения", exact: true }).click();
  await page
    .getByRole("heading", { name: "Подключённые приложения" })
    .waitFor();
  await page.getByRole("heading", { name: "TrioZ (test)" }).waitFor();
  await page.screenshot({
    path: `${dir}/applications-desktop.png`,
    fullPage: true,
  });
  const cross = await page.evaluate(async () => {
    const response = await fetch("/api/tz-id/applications", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    return response.status;
  });
  assert.equal(cross, 400);
  console.log("PASS management API validates required client ID");
  await page.getByRole("button", { name: "Отключить", exact: true }).click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Подтвердить", exact: true })
    .click();
  await page
    .getByText("Пока нет подключённых приложений.", { exact: false })
    .waitFor();
  assert.equal(
    (
      await db.tzIdAuthorization.findMany({
        where: { userId: user.id, revokedAt: null },
      })
    ).length,
    0,
  );
  console.log("PASS connected app UI revokes the existing user's grant");
  await page.screenshot({
    path: `${dir}/applications-empty.png`,
    fullPage: true,
  });
  await page.goto("http://127.0.0.1:3300/admin/tz-id");
  await page
    .getByRole("heading", { name: "Приложения TZ ID", exact: true })
    .waitFor();
  await page
    .getByRole("heading", { name: "TrioZ (test) · включено", exact: true })
    .waitFor();
  const registry = await page.evaluate(
    async () => await (await fetch("/api/admin/tz-id")).json(),
  );
  assert.ok(registry.some((item: any) => item.name === "TrioZ (test)"));
  assert.ok(
    registry.every(
      (item: any) => !("clientSecret" in item) && !("metadata" in item),
    ),
  );
  console.log(
    "PASS administrator registry lists clients without exposing stored secrets",
  );
  await page.screenshot({ path: `${dir}/admin-desktop.png`, fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("http://127.0.0.1:3300/settings?section=tzid");
  await page
    .getByRole("heading", { name: "Ваш постоянный идентификатор" })
    .waitFor();
  await page.screenshot({ path: `${dir}/settings-mobile.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  console.log("PASS responsive settings: no horizontal overflow at 390px");
  await page.goto("http://127.0.0.1:3300/admin/tz-id");
  await page
    .getByRole("heading", { name: "TrioZ (test) · включено", exact: true })
    .waitFor();
  await page.screenshot({ path: `${dir}/admin-mobile.png`, fullPage: true });
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  );
  await page.route("**/api/tz-id/applications", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: '{"error":"test-only service unavailable"}',
    }),
  );
  await page.goto("http://127.0.0.1:3300/settings?section=applications");
  await page.getByRole("button", { name: "Повторить", exact: true }).waitFor();
  await page.screenshot({
    path: `${dir}/applications-error-mobile.png`,
    fullPage: true,
  });
  await page.unroute("**/api/tz-id/applications");
  await page.getByRole("button", { name: "Повторить", exact: true }).click();
  await page
    .getByText("Пока нет подключённых приложений.", { exact: false })
    .waitFor();
  console.log(
    "PASS applications load failure is recoverable via retry; admin mobile has no overflow",
  );
  // Revoke only other sessions. Keep this website session live.
  const revokeOthers = await page.evaluate(async () => {
    const r = await fetch("/api/profile/sessions", { method: "DELETE" });
    return r.status;
  });
  assert.equal(revokeOthers, 200);
  session = await page.evaluate(
    async () => await (await fetch("/api/auth/session")).json(),
  );
  assert.equal(session.user.id, user.id);
  console.log("PASS terminate other sessions keeps current website session");
  const terminate = await page.evaluate(
    async (sid) =>
      (
        await fetch(
          `/api/profile/sessions?sessionId=${encodeURIComponent(sid)}`,
          { method: "DELETE" },
        )
      ).status,
    session.user.sessionId,
  );
  assert.equal(terminate, 200);
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/profile")).status),
    401,
  );
  console.log(
    "PASS current session termination immediately denies protected APIs",
  );
  // Existing credentials remain available; return to the same user, never create another.
  await page.evaluate(
    async (args) => {
      const csrf = await (await fetch("/api/auth/csrf")).json();
      await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrfToken: csrf.csrfToken,
          email: args.email,
          password: args.password,
          json: "true",
          callbackUrl: "/settings",
        }),
      });
    },
    { email: user.email, password },
  );
  session = await page.evaluate(
    async () => await (await fetch("/api/auth/session")).json(),
  );
  assert.equal(session.user.id, user.id);
  console.log(
    "PASS existing credentials login still works for the same account",
  );
  const changedPassword = randomBytes(16).toString("base64url");
  const passwordUpdate = await page.evaluate(
    async (args) =>
      (
        await fetch("/api/profile", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            currentPassword: args.old,
            newPassword: args.next,
          }),
        })
      ).status,
    { old: password, next: changedPassword },
  );
  assert.equal(passwordUpdate, 200);
  assert.ok(
    (await db.user.findUnique({ where: { id: user.id } }))?.passwordChangedAt,
  );
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/profile")).status),
    401,
  );
  await page.evaluate(
    async (args) => {
      const csrf = await (await fetch("/api/auth/csrf")).json();
      await fetch("/api/auth/callback/credentials", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          csrfToken: csrf.csrfToken,
          email: args.email,
          password: args.password,
          json: "true",
          callbackUrl: "/settings",
        }),
      });
    },
    { email: user.email, password: changedPassword },
  );
  session = await page.evaluate(
    async () => await (await fetch("/api/auth/session")).json(),
  );
  assert.equal(session.user.id, user.id);
  console.log(
    "PASS profile password change invalidates sessions; new-password login retains identity",
  );
  const deletion = await page.evaluate(
    async (password) =>
      (
        await fetch("/api/profile/delete", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ password }),
        })
      ).status,
    changedPassword,
  );
  assert.equal(deletion, 200);
  assert.equal(
    (await db.user.findUnique({ where: { id: user.id } }))?.isDeleted,
    true,
  );
  assert.ok(await db.message.findUnique({ where: { id: message.id } }));
  assert.ok(await db.group.findUnique({ where: { id: group.id } }));
  assert.equal(
    await page.evaluate(async () => (await fetch("/api/profile")).status),
    401,
  );
  console.log(
    "PASS account deletion anonymizes identity, revokes sessions, preserves community content",
  );
  console.log("Web integration suite passed.");
} finally {
  if (browser) await browser.close();
  id.kill("SIGTERM");
  web.kill("SIGTERM");
  await new Promise((r) => setTimeout(r, 500));
  await db.tzIdClient.delete({ where: { id: client.clientId } });
  await db.user.delete({ where: { id: user.id } });
  await db.$disconnect();
}
