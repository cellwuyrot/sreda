import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/rateLimit", () => ({ rateLimit: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/banCheck", () => ({ checkBan: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/sanitize", () => ({ sanitizeText: (text: string) => text.trim() }));

import { getServerSession } from "next-auth";
import { GET } from "./route";

const session = vi.mocked(getServerSession);

function request(query: string) {
  return new Request(`http://localhost/api/calendar?channelId=cal-1&${query}`);
}

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "admin-1", role: "USER" } } as never);
  prismaMock.channel.findUnique.mockResolvedValue(row({ groupId: "group-1" }));
  prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
  prismaMock.calendarEvent.findMany.mockResolvedValue([]);
  prismaMock.calendarEventSubscription.findMany.mockResolvedValue([]);
});

describe("GET /api/calendar — диапазон", () => {
  it("возвращает 400 для невалидной даты", async () => {
    const res = await GET(request("from=not-a-date"));
    expect(res.status).toBe(400);
    expect(prismaMock.calendarEvent.findMany).not.toHaveBeenCalled();
  });

  it("ищет события по пересечению интервалов", async () => {
    const res = await GET(request("from=2026-09-01T00:00:00.000Z&to=2026-09-30T23:59:59.000Z"));
    expect(res.status).toBe(200);
    expect(prismaMock.calendarEvent.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({
        channelId: "cal-1",
        AND: expect.arrayContaining([
          { start: { lte: new Date("2026-09-30T23:59:59.000Z") } },
          {
            OR: [
              { end: { gte: new Date("2026-09-01T00:00:00.000Z") } },
              { end: null, start: { gte: new Date("2026-09-01T00:00:00.000Z") } },
            ],
          },
        ]),
      }),
    }));
  });
});