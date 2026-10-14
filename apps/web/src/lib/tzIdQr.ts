import { createHash, randomBytes, randomInt } from "node:crypto";
import prisma from "./prisma";
import { liveSession } from "./tzIdSessions";
import { HubError } from "./tzIdHub";
export const qrHash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
export const qrSecret = () => randomBytes(32).toString("base64url");
export async function startQr(
  interactionUid: string,
  clientId: string | null,
  browserToken: string,
) {
  const approval = qrSecret();
  const row = await prisma.$transaction(async (tx) => {
    await tx.tzIdQrLogin.deleteMany({
      where: {
        interactionUid,
        browserHash: qrHash(browserToken),
        consumedAt: null,
      },
    });
    return tx.tzIdQrLogin.create({
      data: {
        interactionUid,
        clientId,
        browserHash: qrHash(browserToken),
        approvalHash: qrHash(approval),
        verificationCode: String(randomInt(100000, 1000000)),
        expiresAt: new Date(Date.now() + 120_000),
      },
    });
  });
  return {
    id: row.id,
    approval,
    verificationCode: row.verificationCode,
    expiresAt: row.expiresAt,
  };
}
export async function qrForApproval(code: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(code))
    throw new HubError("QR-код истёк или недействителен", 410);
  const row = await prisma.tzIdQrLogin.findUnique({
    where: { approvalHash: qrHash(code) },
  });
  if (!row || row.expiresAt <= new Date() || row.consumedAt)
    throw new HubError("QR-код истёк или недействителен", 410);
  if (
    row.clientId &&
    !(await prisma.tzIdClient.findFirst({
      where: { id: row.clientId, enabled: true },
      select: { id: true },
    }))
  )
    throw new HubError("Проект отключён", 403);
  return row;
}
export async function approveQr(
  code: string,
  userId: string,
  sessionId: string,
  verificationCode: string,
  deny = false,
) {
  if (!(await liveSession(userId, sessionId)))
    throw new HubError("Войдите в TZ ID", 401);
  const row = await qrForApproval(code);
  if (row.verificationCode !== verificationCode)
    throw new HubError("Коды подтверждения не совпадают", 403);
  const result = await prisma.tzIdQrLogin.updateMany({
    where: {
      id: row.id,
      expiresAt: { gt: new Date() },
      consumedAt: null,
      approvedUserId: null,
    },
    data: deny
      ? { consumedAt: new Date() }
      : { approvedUserId: userId, approvedSessionId: sessionId },
  });
  if (result.count !== 1) throw new HubError("Этот QR-код уже обработан", 409);
}
export async function qrStatus(
  id: string,
  interactionUid: string,
  browserToken: string,
) {
  const row = await prisma.tzIdQrLogin.findFirst({
    where: { id, interactionUid, browserHash: qrHash(browserToken) },
  });
  if (!row || row.consumedAt || row.expiresAt <= new Date())
    return { state: "expired" as const };
  if (!row.approvedUserId || !row.approvedSessionId)
    return { state: "pending" as const };
  if (!(await liveSession(row.approvedUserId, row.approvedSessionId)))
    return { state: "expired" as const };
  return { state: "approved" as const };
}
export async function consumeQr(
  id: string,
  interactionUid: string,
  browserToken: string,
) {
  const row = await prisma.tzIdQrLogin.findFirst({
    where: {
      id,
      interactionUid,
      browserHash: qrHash(browserToken),
      expiresAt: { gt: new Date() },
      consumedAt: null,
    },
  });
  if (
    !row?.approvedUserId ||
    !row.approvedSessionId ||
    !(await liveSession(row.approvedUserId, row.approvedSessionId))
  )
    throw new HubError("Подтверждение истекло. Создайте новый QR-код", 401);
  if (
    row.clientId &&
    !(await prisma.tzIdClient.findFirst({
      where: { id: row.clientId, enabled: true },
    }))
  )
    throw new HubError("Проект отключён", 403);
  const result = await prisma.tzIdQrLogin.updateMany({
    where: { id: row.id, consumedAt: null, expiresAt: { gt: new Date() } },
    data: { consumedAt: new Date() },
  });
  if (result.count !== 1) throw new HubError("QR-код уже использован", 409);
  return row.approvedUserId;
}
