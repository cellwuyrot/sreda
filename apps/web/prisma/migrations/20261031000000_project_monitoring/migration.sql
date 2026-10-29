ALTER TABLE "ServerNode" ADD COLUMN "monitorReport" TEXT, ADD COLUMN "monitorSeenAt" TIMESTAMP(3);
CREATE TABLE "ProjectDeployment" (
 "id" TEXT NOT NULL PRIMARY KEY, "projectId" TEXT NOT NULL, "nodeId" TEXT NOT NULL,
 "appName" TEXT NOT NULL, "namespace" TEXT NOT NULL DEFAULT 'default', "required" BOOLEAN NOT NULL DEFAULT true,
 "enabled" BOOLEAN NOT NULL DEFAULT true, "healthRequired" BOOLEAN NOT NULL DEFAULT true, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
 CONSTRAINT "ProjectDeployment_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "PartnerProject"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 CONSTRAINT "ProjectDeployment_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "ServerNode"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProjectDeployment_nodeId_appName_namespace_key" ON "ProjectDeployment"("nodeId","appName","namespace");
CREATE INDEX "ProjectDeployment_projectId_idx" ON "ProjectDeployment"("projectId");
CREATE TABLE "MonitorSample" ("id" TEXT NOT NULL PRIMARY KEY,"nodeId" TEXT NOT NULL,"sampledAt" TIMESTAMP(3) NOT NULL,"receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,"payload" TEXT NOT NULL);
CREATE INDEX "MonitorSample_nodeId_sampledAt_idx" ON "MonitorSample"("nodeId","sampledAt");

CREATE INDEX "MonitorSample_receivedAt_idx" ON "MonitorSample"("receivedAt");
