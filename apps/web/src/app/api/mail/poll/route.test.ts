import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));
vi.mock("next-auth", () => ({ getServerSession: vi.fn() }));
vi.mock("@/lib/auth", () => ({ authOptions: {} }));
vi.mock("@/lib/mailImap", () => ({ fetchSinceUid: vi.fn() }));
vi.mock("@/lib/mailBlacklist", () => ({
  readMailBlacklist: vi.fn(() => []),
  isBlacklistedSender: vi.fn(() => false),
}));

import { getServerSession } from "next-auth";
import { fetchSinceUid } from "@/lib/mailImap";

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getServerSession).mockResolvedValue({ user: { role: "ADMIN" } } as never);
  prismaMock.projectMailbox.upsert.mockResolvedValue(row({
    id: "box-1", localPart: "info", lastSyncedUid: BigInt(0), imapUidValidity: null,
  }));
  prismaMock.projectMailbox.update.mockResolvedValue(row({ id: "box-1" }));
  prismaMock.projectMailbox.updateMany.mockResolvedValue(row({ count: 1 }));
  prismaMock.mailDeletionTombstone.findUnique.mockResolvedValue(null);
  prismaMock.mailMessage.findFirst.mockResolvedValue(null);
  prismaMock.mailMessage.create.mockResolvedValue(row({ id: "message" }));
});

describe("POST /api/mail/poll UID sync", () => {
  it("обрабатывает все 150 новых UID без старого лимита 100", async () => {
    vi.mocked(fetchSinceUid).mockResolvedValue({
      uidValidity: BigInt(7),
      messages: Array.from({ length: 150 }, (_, index) => ({
        imapUid: index + 1,
        direction: "incoming" as const,
        fromAddr: `sender${index}@example.com`,
        toAddr: "info@trioz.ru",
        subject: `Message ${index}`,
        preview: "body",
        bodyText: "body",
        bodyHtml: null,
        messageId: `<message-${index}@example.com>`,
        sentAt: new Date(1700000000000 + index),
      })),
    });
    const { POST } = await import("./route");
    const req = new Request("http://localhost/api/mail/poll", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address: "info" }),
    });
    const response = await POST(req as never);
    const data = await response.json();

    expect(response.status).toBe(200);
    expect(data).toMatchObject({ ok: true, fetched: 150, stored: 150 });
    expect(prismaMock.mailMessage.create).toHaveBeenCalledTimes(150);
    expect(prismaMock.projectMailbox.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ lastSyncedUid: BigInt(150) }),
    }));
  });
});