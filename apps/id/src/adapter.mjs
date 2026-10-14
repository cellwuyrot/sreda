import { createHash } from "node:crypto";
/** Server-side storage. Token identifiers are hashed; contents are authenticated-encrypted. */
export function makeAdapter(db, { seal, open, requestInfo = () => ({}) }) {
  const key = (model, id) =>
    createHash("sha256").update(`${model}:${id}`).digest("hex");
  async function active(session) {
    if (
      !session?.active ||
      !session.expiresAt ||
      session.expiresAt <= new Date()
    )
      return false;
    const user = await db.user.findUnique({ where: { id: session.userId } });
    return (
      !!user &&
      !user.isDeleted &&
      !(user.banned && (!user.bannedUntil || user.bannedUntil > new Date())) &&
      (!user.passwordChangedAt || user.passwordChangedAt <= session.createdAt)
    );
  }
  return class Adapter {
    constructor(model) {
      this.model = model;
    }
    async upsert(id, payload, expiresIn) {
      if (this.model === "Client")
        throw new Error("Dynamic client registration is disabled");
      if (this.model === "Session" && payload.accountId) {
        const info = requestInfo();
        await db.userSession.upsert({
          where: { token: `oidc:${payload.uid}` },
          create: {
            userId: payload.accountId,
            token: `oidc:${payload.uid}`,
            expiresAt: new Date(payload.exp * 1000),
            ...info,
          },
          update: {
            lastUsed: new Date(),
            expiresAt: new Date(payload.exp * 1000),
          },
        });
      }
      const data = {
        model: this.model,
        payload: seal(payload),
        uid: payload.uid ?? null,
        grantId: this.model === "Grant" ? id : (payload.grantId ?? null),
        userCode: payload.userCode ?? null,
        expiresAt: new Date(Date.now() + expiresIn * 1000),
      };
      await db.tzIdArtifact.upsert({
        where: { key: key(this.model, id) },
        create: { key: key(this.model, id), ...data },
        update: data,
      });
    }
    async read(row) {
      if (!row || row.expiresAt <= new Date()) return undefined;
      const payload = open(row.payload);
      if (this.model === "Session" && payload.accountId) {
        if (
          !(await active(
            await db.userSession.findUnique({
              where: { token: `oidc:${payload.uid}` },
            }),
          ))
        )
          return undefined;
      }
      const grantId = row.grantId;
      if (
        grantId &&
        ["Grant", "AccessToken", "RefreshToken", "AuthorizationCode"].includes(
          this.model,
        )
      ) {
        const auth = await db.tzIdAuthorization.findUnique({
          where: { id: grantId },
          include: { session: true, client: true },
        });
        if (
          !auth ||
          auth.revokedAt ||
          !auth.client.enabled ||
          !(await active(auth.session))
        )
          return undefined;
      }
      if (row.consumedAt)
        payload.consumed = Math.floor(row.consumedAt.getTime() / 1000);
      return payload;
    }
    async find(id) {
      if (this.model === "Client") {
        const client = await db.tzIdClient.findUnique({ where: { id } });
        return client?.enabled ? open(client.metadata) : undefined;
      }
      return this.read(
        await db.tzIdArtifact.findUnique({
          where: { key: key(this.model, id) },
        }),
      );
    }
    async findByUid(uid) {
      return this.read(
        await db.tzIdArtifact.findFirst({ where: { model: this.model, uid } }),
      );
    }
    async findByUserCode(userCode) {
      return this.read(
        await db.tzIdArtifact.findFirst({
          where: { model: this.model, userCode },
        }),
      );
    }
    async destroy(id) {
      await db.tzIdArtifact.deleteMany({ where: { key: key(this.model, id) } });
      if (this.model === "Grant")
        await db.tzIdAuthorization.updateMany({
          where: { id },
          data: { revokedAt: new Date() },
        });
    }
    async consume(id) {
      const result = await db.tzIdArtifact.updateMany({
        where: { key: key(this.model, id), consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (result.count !== 1)
        throw new Error("Code or refresh token already consumed");
    }
    async revokeByGrantId(grantId) {
      await db.tzIdArtifact.deleteMany({ where: { grantId } });
      await db.tzIdAuthorization.updateMany({
        where: { id: grantId },
        data: { revokedAt: new Date() },
      });
    }
  };
}
