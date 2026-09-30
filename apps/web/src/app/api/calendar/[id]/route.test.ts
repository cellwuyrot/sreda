import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/sanitize", () => ({ sanitizeText: (text: string) => text.trim() }));

import { getServerSession } from "next-auth";
import { PATCH } from "./route";

const session = vi.mocked(getServerSession);
const params = { params: Promise.resolve({ id: "event-1" }) };

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "admin-1", role: "USER" } } as never);
  prismaMock.calendarEvent.findUnique.mockResolvedValue(row({
    id: "event-1",
    authorId: "author-1",
    start: new Date("2026-09-30T12:00:00.000Z"),
    end: null,
    channel: { groupId: "group-1" },
  }));
  prismaMock.groupMember.findUnique.mockResolvedValue(row({ role: "ADMIN" }));
});

describe("PATCH /api/calendar/[id]", () => {
  it("не позволяет сохранить окончание раньше начала", async () => {
    const req = new Request("http://localhost/api/calendar/event-1", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ end: "2026-09-30T11:00:00.000Z" }),
    }) as unknown as import("next/server").NextRequest;

    const res = await PATCH(req, params);

    expect(res.status).toBe(400);
    expect(prismaMock.calendarEvent.update).not.toHaveBeenCalled();
  });
});