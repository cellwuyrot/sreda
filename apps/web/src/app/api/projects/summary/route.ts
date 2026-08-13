import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { summarizeInvoices } from "@/lib/projectBusiness";
import { isStaffRole } from "@/lib/roles";

/**
 * BUSINESS-CABINET: сводка по проектам для личного кабинета и панели.
 *
 * Партнёр видит только СВОИ проекты, сотрудник — все. Фильтр строится на сервере
 * и не зависит от параметров запроса: иначе достаточно было бы подменить scope
 * в адресной строке, чтобы увидеть чужие деньги.
 */
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const isStaff = isStaffRole(session.user.role);
  const where = isStaff ? {} : { ownerId: session.user.id };

  const projects = await prisma.partnerProject.findMany({
    where,
    orderBy: [{ dueDate: "asc" }, { updatedAt: "desc" }],
    take: 200,
    select: {
      id: true,
      name: true,
      status: true,
      dueDate: true,
      updatedAt: true,
      responsible: { select: { id: true, name: true, username: true } },
      service: { select: { id: true, title: true } },
      invoices: { select: { amount: true, status: true } },
      _count: { select: { documents: true, events: true, messages: true } },
    },
  });

  const rows = projects.map((project) => ({
    id: project.id,
    name: project.name,
    status: project.status,
    dueDate: project.dueDate,
    updatedAt: project.updatedAt,
    service: project.service,
    responsible: project.responsible,
    documents: project._count.documents,
    events: project._count.events,
    messages: project._count.messages,
    money: summarizeInvoices(project.invoices),
  }));

  const totals = rows.reduce(
    (acc, row) => ({
      billed: acc.billed + row.money.billed,
      paid: acc.paid + row.money.paid,
      unpaid: acc.unpaid + row.money.unpaid,
    }),
    { billed: 0, paid: 0, unpaid: 0 },
  );

  return NextResponse.json({
    isStaff,
    projects: rows,
    totals,
    counts: {
      total: rows.length,
      active: rows.filter((row) => row.status !== "LAUNCHED").length,
      overdue: rows.filter((row) => row.dueDate && row.status !== "LAUNCHED" && row.dueDate < new Date()).length,
    },
  });
}
