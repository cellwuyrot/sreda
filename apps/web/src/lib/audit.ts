import prisma from "./prisma";

interface AuditParams {
  userId: string;
  username: string;
  action: string;
  target: string;
  targetId?: string;
  details?: string;
}

const DEDUP_WINDOW_MS = 10 * 60 * 1000; // 10 minutes

export async function logAction(params: AuditParams): Promise<void> {
  try {
    const windowStart = new Date(Date.now() - DEDUP_WINDOW_MS);

    const existing = await prisma.auditLog.findFirst({
      where: {
        userId: params.userId,
        action: params.action,
        target: params.target,
        targetId: params.targetId || null,
        createdAt: { gte: windowStart },
      },
      orderBy: { createdAt: "desc" },
    });

    if (existing) {
      await prisma.auditLog.update({
        where: { id: existing.id },
        data: {
          details: params.details || existing.details,
          createdAt: new Date(),
        },
      });
    } else {
      await prisma.auditLog.create({
        data: {
          userId: params.userId,
          username: params.username,
          action: params.action,
          target: params.target,
          targetId: params.targetId || null,
          details: params.details || null,
        },
      });
    }
  } catch (e) {
    console.error("[AuditLog] Failed to log action:", e);
  }
}
