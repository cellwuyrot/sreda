import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
const emit = vi.fn();
const io = { to: vi.fn(() => ({ emit })) };
vi.mock("@/lib/socketEmit", () => ({ getIO: () => io }));
const queuePush = vi.fn();
vi.mock("@/lib/push", () => ({ queuePush: (...args: unknown[]) => queuePush(...args) }));

import { createNotificationsBulk } from "@/lib/createNotification";

beforeEach(() => {
  emit.mockReset();
  io.to.mockClear();
  queuePush.mockReset();
  prismaMock.user.findMany.mockResolvedValue(row([{ id: "u1", notifyPush: true }]));
  prismaMock.notification.update.mockResolvedValue(row({
    id: "n1", userId: "u1", type: "mention", entityType: "thread", entityId: "thread-1", count: 2,
  }));
});

describe("bulk notification grouping", () => {
  it("повторный @everyone по тому же Thread обновляет существующую строку", async () => {
    prismaMock.notification.findMany.mockResolvedValue(row([{ id: "n1", userId: "u1" }]));

    const processed = await createNotificationsBulk({
      userIds: ["u1"],
      type: "mention",
      title: "Упоминание всех",
      entityType: "thread",
      entityId: "thread-1",
    });

    expect(processed).toBe(1);
    expect(prismaMock.notification.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "n1" },
      data: expect.objectContaining({ count: { increment: 1 } }),
    }));
    expect(prismaMock.notification.createManyAndReturn).not.toHaveBeenCalled();
    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ isNew: false }));
  });
});
