import prisma from "@/lib/prisma";
import { isStaffRole } from "@/lib/roles";

/**
 * BUSINESS-CABINET: бизнес-часть проекта личного кабинета партнёра.
 *
 * Сроки, ответственные, счета и документы раньше существовали только в виде
 * сообщений в деловом чате. Здесь собраны проверки доступа и запись истории,
 * чтобы каждый роут не переписывал правила заново (именно так в проекте и
 * появились расхождения между кнопкой в интерфейсе и правами на сервере).
 */

export const INVOICE_STATUSES = ["UNPAID", "PAID", "CANCELLED"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const INVOICE_METHODS = ["sbp", "acquiring", "invoice", "manual"] as const;

export const DOCUMENT_KINDS = ["CONTRACT", "ACT", "APPENDIX", "OTHER"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

export const DOCUMENT_KIND_LABEL: Record<DocumentKind, string> = {
  CONTRACT: "Договор",
  ACT: "Акт",
  APPENDIX: "Приложение",
  OTHER: "Документ",
};

export const EVENT_KINDS = [
  "STAGE_DONE",
  "DUE_DATE",
  "RESPONSIBLE",
  "INVOICE_CREATED",
  "INVOICE_STATUS",
  "INVOICE_DECLARED",
  "DOCUMENT_ADDED",
  "DOCUMENT_REMOVED",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === "string" && (INVOICE_STATUSES as readonly string[]).includes(value);
}

export function isDocumentKind(value: unknown): value is DocumentKind {
  return typeof value === "string" && (DOCUMENT_KINDS as readonly string[]).includes(value);
}

/**
 * Ссылка на файл документа должна вести в закрытую папку проектов и не содержать
 * переходов вверх по дереву: иначе в базу можно было бы положить любой адрес.
 */
export function isProjectUploadUrl(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.startsWith("/uploads/projects/") &&
    !value.includes("..") &&
    value.length <= 500
  );
}

/** Разбор даты из тела запроса: undefined — поле не пришло, "invalid" — мусор. */
export function parseDate(value: unknown): Date | null | undefined | "invalid" {
  if (value === undefined) return undefined;
  if (value === null || value === "") return null;
  if (typeof value !== "string") return "invalid";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "invalid" : date;
}

export type ProjectAccess = {
  project: { id: string; ownerId: string; name: string; status: string };
  isStaff: boolean;
  isOwner: boolean;
};

/**
 * Единая проверка доступа к проекту: владелец-партнёр или сотрудник.
 * Возвращает null, если проекта нет или доступа нет (без различия — чтобы по коду
 * ответа нельзя было перебрать существующие идентификаторы проектов).
 */
export async function loadProjectAccess({
  projectId,
  userId,
  role,
}: {
  projectId: string;
  userId: string;
  role: string | null | undefined;
}): Promise<ProjectAccess | null> {
  const project = await prisma.partnerProject.findUnique({
    where: { id: projectId },
    select: { id: true, ownerId: true, name: true, status: true },
  });
  if (!project) return null;
  const isStaff = isStaffRole(role);
  const isOwner = project.ownerId === userId;
  if (!isStaff && !isOwner) return null;
  return { project, isStaff, isOwner };
}

/**
 * Запись события истории. Сознательно не бросает исключений: журнал —
 * вспомогательный, и падение записи не должно отменять уже сделанное действие.
 */
export async function recordProjectEvent({
  projectId,
  kind,
  title,
  details,
  actorId,
  actorName,
  actorSide = "STAFF",
}: {
  projectId: string;
  kind: EventKind;
  title: string;
  details?: string | null;
  actorId?: string | null;
  actorName?: string | null;
  actorSide?: "STAFF" | "CLIENT";
}): Promise<void> {
  try {
    await prisma.projectEvent.create({
      data: {
        projectId,
        kind,
        title: title.slice(0, 200),
        details: details ? details.slice(0, 2000) : null,
        actorId: actorId ?? null,
        actorName: (actorName ?? "").slice(0, 120),
        actorSide,
      },
    });
  } catch {
    /* история не критична — молча пропускаем */
  }
}

/** Сводка по счетам: отменённые в расчёт не идут. */
export function summarizeInvoices(
  invoices: Array<{ amount: number; status: string }>,
): { billed: number; paid: number; unpaid: number } {
  let billed = 0;
  let paid = 0;
  for (const invoice of invoices) {
    if (invoice.status === "CANCELLED") continue;
    billed += invoice.amount;
    if (invoice.status === "PAID") paid += invoice.amount;
  }
  return { billed, paid, unpaid: billed - paid };
}
