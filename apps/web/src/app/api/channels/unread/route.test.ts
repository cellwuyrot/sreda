import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));

import { getServerSession } from "next-auth";
import { GET } from "./route";

const session = vi.mocked(getServerSession);

beforeEach(() => {
  session.mockResolvedValue({ user: { id: "reader" } } as never);
  prismaMock.channelMember.findMany.mockResolvedValue(row([
    { channelId: "channel-1", lastRead: new Date("2026-09-20T10:00:00Z") },
  ]));
  prismaMock.channel.findMany.mockResolvedValue(row([
    { id: "channel-1", groupId: "group-1", name: "general", type: "TEXT" },
  ]));
  prismaMock.channelMute.findMany.mockResolvedValue(row([]));
  prismaMock.groupMember.findMany.mockResolvedValue(row([]));
  prismaMock.message.groupBy.mockResolvedValue(row([
    { channelId: "channel-1", _count: { _all: 0 } },
  ]));
  prismaMock.message.findMany.mockResolvedValue(row([]));
});

describe("GET /api/channels/unread — единая модель Thread (вариант A)", () => {
  it("считает replies частью канала только пока нет адресного MessageRead", async () => {
    const response = await GET();
    expect(response.status).toBe(200);

    const call = prismaMock.message.groupBy.mock.calls[0][0] as {
      where: { AND: Array<{ OR?: unknown[] }> };
    };
    const threadClause = call.where.AND[1];
    expect(threadClause).toEqual({
      OR: [
        { threadId: null },
        { threadId: { not: null }, reads: { none: { userId: "reader" } } },
      ],
    });
  });

  it("после адресного прочтения трёх replies серверный count может стать нулём", async () => {
    prismaMock.message.groupBy.mockResolvedValue(row([]));
    const response = await GET();
    await expect(response.json()).resolves.toMatchObject({ unread: {} });
  });
});
