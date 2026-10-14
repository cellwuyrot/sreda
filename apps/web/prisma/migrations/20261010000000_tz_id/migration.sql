ALTER TABLE "UserSession" ADD COLUMN "expiresAt" TIMESTAMP(3);
CREATE TABLE "TzIdClient" (
 "id" TEXT PRIMARY KEY, "name" TEXT NOT NULL, "metadata" TEXT NOT NULL,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "TzIdArtifact" (
 "key" TEXT PRIMARY KEY, "model" TEXT NOT NULL, "payload" TEXT NOT NULL,
 "uid" TEXT, "grantId" TEXT, "userCode" TEXT, "expiresAt" TIMESTAMP(3) NOT NULL,
 "consumedAt" TIMESTAMP(3)
);
CREATE INDEX "TzIdArtifact_uid_idx" ON "TzIdArtifact"("uid");
CREATE INDEX "TzIdArtifact_grantId_idx" ON "TzIdArtifact"("grantId");
CREATE INDEX "TzIdArtifact_expiresAt_idx" ON "TzIdArtifact"("expiresAt");
CREATE TABLE "TzIdAuthorization" (
 "id" TEXT PRIMARY KEY, "userId" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "clientId" TEXT NOT NULL REFERENCES "TzIdClient"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "sessionId" TEXT NOT NULL REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "scopes" TEXT NOT NULL, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "revokedAt" TIMESTAMP(3)
);
CREATE INDEX "TzIdAuthorization_userId_idx" ON "TzIdAuthorization"("userId");
CREATE INDEX "TzIdAuthorization_sessionId_idx" ON "TzIdAuthorization"("sessionId");
