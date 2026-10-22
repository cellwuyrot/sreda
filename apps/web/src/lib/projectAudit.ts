import type { Prisma } from "@prisma/client";

export const AUDIT_WINDOW_DAYS = 30;
// Fail closed: community, wall, DM, E2EE, mailbox and unknown targets are NOT
// project events. Legacy records lack scope, so a denylist would leak new targets.
export const PROJECT_AUDIT_TARGETS = [
  "WindowConfig", "SiteContent", "AISettings", "Badge", "PartnerProject",
  "Appeal", "PremiumSubscription", "VpnSubscription", "PaymentSettings",
  "PaymentLink", "EmailDomainWhitelist", "TzIdProjectRole",
];
export function projectAuditWhere(now = new Date()): Prisma.AuditLogWhereInput {
  return {
    createdAt: { gte: new Date(now.getTime() - AUDIT_WINDOW_DAYS * 86400000), lte: now },
    OR: [
      { target: { in: PROJECT_AUDIT_TARGETS } },
      // Profile changes use the same target, but are not site moderation.
      { target: "User", action: { in: ["update", "delete", "ban", "unban"] } },
      // These site billing routes historically use human-readable targets.
      { action: { in: [
        "payments.requisite.create", "payments.requisite.update", "payments.requisite.delete",
        "business.payment.issue", "business.payment.status",
      ] } },
    ],
  };
}
