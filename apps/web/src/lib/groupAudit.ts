import prisma from "@/lib/prisma";

export type GroupAuditAction =
  | "settings.update"
  | "member.role"
  | "member.kick"
  | "member.timeout"
  | "member.untimeout"
  | "ban.add"
  | "ban.remove"
  | "invite.create"
  | "invite.revoke"
  // MODERATION: удаление чужих сообщений и разбор жалоб.
  | "message.delete"
  | "message.purge"
  | "report.resolve"
  | "report.dismiss"
  // CENSOR: правки словаря цензуры. Кто и когда внёс слово в запрет — то же по
  // важности, что и бан: решение про чужую речь должно быть подписано.
  | "censor.add"
  | "censor.level"
  | "censor.remove";

/**
 * Записывает событие в журнал аудита группы (GroupAuditEntry).
 * Ошибки логирования никогда не должны ломать основное действие,
 * поэтому исключения глушатся с console.error.
 */
export async function logGroupAction(entry: {
  groupId: string;
  actorId: string;
  actorName: string;
  action: GroupAuditAction;
  targetId?: string;
  targetName?: string;
  details?: string;
}): Promise<void> {
  try {
    await prisma.groupAuditEntry.create({ data: entry });
  } catch (e) {
    console.error("groupAudit: failed to write audit entry", e);
  }
}
