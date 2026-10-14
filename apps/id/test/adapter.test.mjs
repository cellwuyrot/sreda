import test from "node:test";
import assert from "node:assert/strict";
import { makeAdapter } from "../src/adapter.mjs";
import { accountClaims } from "../src/provider.mjs";
const seal = (x) => JSON.stringify(x),
  open = (x) => JSON.parse(x);
function fixture() {
  const rows = new Map();
  let session = {
    userId: "u1",
    active: true,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 100000),
  };
  let auth = { session, client: { enabled: true }, revokedAt: null };
  const db = {
    user: {
      findUnique: async () => ({
        id: "u1",
        banned: false,
        isDeleted: false,
        passwordChangedAt: null,
      }),
    },
    userSession: {
      findUnique: async () => session,
      upsert: async () => session,
    },
    tzIdAuthorization: {
      findUnique: async () => auth,
      updateMany: async () => {
        auth.revokedAt = new Date();
      },
    },
    tzIdClient: {
      findUnique: async () => ({
        enabled: auth.client.enabled,
        metadata: seal({ client_id: "c1" }),
      }),
    },
    tzIdArtifact: {
      upsert: async ({ where, create, update }) => {
        rows.set(
          where.key,
          rows.has(where.key) ? { ...rows.get(where.key), ...update } : create,
        );
      },
      findUnique: async ({ where }) => rows.get(where.key),
      deleteMany: async () => {
        rows.clear();
      },
      updateMany: async ({ where, data }) => {
        const row = rows.get(where.key);
        if (!row || row.consumedAt) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
  };
  return { Adapter: makeAdapter(db, { seal, open }), rows, session, auth, db };
}
test("Grant stores explicit grantId and is denied when authorization revoked", async () => {
  const f = fixture(),
    a = new f.Adapter("Grant");
  await a.upsert("grant-1", { accountId: "u1", clientId: "c1" }, 100);
  assert.equal([...f.rows.values()][0].grantId, "grant-1");
  assert.ok(await a.find("grant-1"));
  f.auth.revokedAt = new Date();
  assert.equal(await a.find("grant-1"), undefined);
});
test("Opaque access token denied for ended session or disabled client", async () => {
  const f = fixture(),
    a = new f.Adapter("AccessToken");
  await a.upsert("opaque", { grantId: "grant-1" }, 100);
  assert.ok(await a.find("opaque"));
  f.session.active = false;
  assert.equal(await a.find("opaque"), undefined);
  f.session.active = true;
  f.auth.client.enabled = false;
  assert.equal(await a.find("opaque"), undefined);
});
test("Client registry disabled clients are unavailable immediately", async () => {
  const f = fixture(),
    a = new f.Adapter("Client");
  assert.ok(await a.find("c1"));
  f.auth.client.enabled = false;
  assert.equal(await a.find("c1"), undefined);
  await assert.rejects(a.upsert("c1", {}, 100));
});
test("Atomic consumption rejects replay, exposes consumed marker", async () => {
  const f = fixture(),
    a = new f.Adapter("AuthorizationCode");
  await a.upsert("code", { grantId: "g1" }, 100);
  await a.consume("code");
  assert.equal(typeof (await a.find("code")).consumed, "number");
  await assert.rejects(a.consume("code"));
});
test("Expired artifacts unavailable", async () => {
  const f = fixture(),
    a = new f.Adapter("Grant");
  await a.upsert("g", {}, -1);
  assert.equal(await a.find("g"), undefined);
});
test("Only public identity fields become claims", () => {
  const claims = accountClaims(
    {
      id: "stable",
      name: "A",
      username: "a",
      email: "a@example.invalid",
      emailVerified: false,
      avatar: "/avatar.png",
      role: "ADMIN",
      password: "secret",
      bio: "private",
    },
    "https://trioz.ru",
  );
  assert.equal(claims.sub, "stable");
  assert.equal(claims.picture, "https://trioz.ru/avatar.png");
  assert.equal(claims.email_verified, false);
  assert.equal(claims.role, undefined);
  assert.equal(claims.password, undefined);
  assert.equal(claims.bio, undefined);
});

test("Invalid or non-HTTP avatar is omitted without breaking identity claims", () => {
  for (const avatar of ["https://[invalid", "javascript:alert(1)"]) {
    const claims = accountClaims({ id: "stable", avatar }, "https://trioz.ru");
    assert.equal(claims.sub, "stable");
    assert.equal(claims.picture, undefined);
  }
});

test("Legacy sessions without an expiry never authorize a TZ ID token", async () => {
  const f = fixture(),
    a = new f.Adapter("AccessToken");
  await a.upsert("opaque", { grantId: "g" }, 100);
  f.session.expiresAt = null;
  assert.equal(await a.find("opaque"), undefined);
});
