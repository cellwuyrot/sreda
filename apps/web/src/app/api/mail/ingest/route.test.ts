import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac } from "crypto";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const WHSEC = "whsec_" + Buffer.from("test-signing-key-1234567890").toString("base64");

function sign(body: string, id: string, ts: number): string {
  const key = Buffer.from(WHSEC.slice("whsec_".length), "base64");
  return "v1," + createHmac("sha256", key).update(`${id}.${ts}.${body}`).digest("base64");
}

function req(body: string, headers: Record<string, string>) {
  return new Request("http://localhost/api/mail/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body,
  }) as unknown as import("next/server").NextRequest;
}

const payload = JSON.stringify({
  direction: "incoming",
  to: "support@trioz.ru",
  from: "client@example.com",
  subject: "Вопрос",
  text: "Текст письма",
  messageId: "mid-1",
});

beforeEach(() => {
  vi.clearAllMocks();
  process.env.MAIL_WEBHOOK_SECRET = WHSEC;
  delete process.env.MAIL_INGEST_SECRET;
  prismaMock.projectMailbox.upsert.mockResolvedValue(row({ id: "box1", localPart: "support" }));
  prismaMock.mailMessage.findFirst.mockResolvedValue(null as never);
  prismaMock.mailMessage.create.mockResolvedValue(row({ id: "m1" }));
});

afterEach(() => {
  delete process.env.MAIL_WEBHOOK_SECRET;
  delete process.env.MAIL_INGEST_SECRET;
});

describe("POST /api/mail/ingest", () => {
  it("принимает письмо с верной подписью whsec_", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const mod = await import("@/app/api/mail/ingest/route");
    const res = await mod.POST(
      req(payload, {
        "webhook-id": "msg_1",
        "webhook-timestamp": String(ts),
        "webhook-signature": sign(payload, "msg_1", ts),
      }),
    );
    expect(res.status).toBe(200);
    expect(prismaMock.mailMessage.create).toHaveBeenCalledOnce();
    const arg = prismaMock.mailMessage.create.mock.calls[0][0];
    expect(arg.data.direction).toBe("incoming");
    expect(arg.data.toAddr).toBe("support@trioz.ru");
  });

  it("отвергает битую подпись (401)", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const mod = await import("@/app/api/mail/ingest/route");
    const res = await mod.POST(
      req(payload, {
        "webhook-id": "msg_1",
        "webhook-timestamp": String(ts),
        "webhook-signature": "v1," + Buffer.from("wrong").toString("base64"),
      }),
    );
    expect(res.status).toBe(401);
    expect(prismaMock.mailMessage.create).not.toHaveBeenCalled();
  });

  it("отвергает устаревший timestamp (401)", async () => {
    const stale = Math.floor(Date.now() / 1000) - 60 * 60;
    const mod = await import("@/app/api/mail/ingest/route");
    const res = await mod.POST(
      req(payload, {
        "webhook-id": "msg_1",
        "webhook-timestamp": String(stale),
        "webhook-signature": sign(payload, "msg_1", stale),
      }),
    );
    expect(res.status).toBe(401);
  });

  it("принимает запасной общий секрет X-Mail-Secret", async () => {
    delete process.env.MAIL_WEBHOOK_SECRET;
    process.env.MAIL_INGEST_SECRET = "shared-secret";
    const mod = await import("@/app/api/mail/ingest/route");
    const res = await mod.POST(req(payload, { "x-mail-secret": "shared-secret" }));
    expect(res.status).toBe(200);
  });

  it("отвергает неверный общий секрет (401)", async () => {
    delete process.env.MAIL_WEBHOOK_SECRET;
    process.env.MAIL_INGEST_SECRET = "shared-secret";
    const mod = await import("@/app/api/mail/ingest/route");
    const res = await mod.POST(req(payload, { "x-mail-secret": "nope" }));
    expect(res.status).toBe(401);
  });

  it("дедуп ищет письмо в пределах ящика", async () => {
    const ts = Math.floor(Date.now() / 1000);
    const mod = await import("@/app/api/mail/ingest/route");
    await mod.POST(
      req(payload, {
        "webhook-id": "msg_1",
        "webhook-timestamp": String(ts),
        "webhook-signature": sign(payload, "msg_1", ts),
      }),
    );
    expect(prismaMock.mailMessage.findFirst).toHaveBeenCalledWith({
      where: { mailboxId: "box1", messageId: "mid-1" },
      select: { id: true },
    });
  });

  it("ретрай вебхука без Message-ID не задваивает письмо", async () => {
    // Без заголовка ключ считается по содержимому — значит у повторного
    // запроса он тот же, и дедуп срабатывает.
    const noMid = JSON.stringify({
      direction: "incoming",
      to: "support@trioz.ru",
      from: "client@example.com",
      subject: "Вопрос",
      text: "Текст письма",
      sentAt: "2026-09-11T09:00:00.000Z",
    });
    delete process.env.MAIL_WEBHOOK_SECRET;
    process.env.MAIL_INGEST_SECRET = "shared-secret";
    const mod = await import("@/app/api/mail/ingest/route");

    const first = await mod.POST(req(noMid, { "x-mail-secret": "shared-secret" }));
    expect(first.status).toBe(200);
    const key = prismaMock.mailMessage.create.mock.calls[0][0].data.messageId;
    expect(key).toMatch(/^synthetic:[0-9a-f]{64}$/);

    // Второй заход: письмо с таким ключом уже лежит в ящике.
    prismaMock.mailMessage.findFirst.mockResolvedValue(row({ id: "m1" }));
    const second = await mod.POST(req(noMid, { "x-mail-secret": "shared-secret" }));
    expect(await second.json()).toMatchObject({ deduped: true, id: "m1" });
    expect(prismaMock.mailMessage.create).toHaveBeenCalledOnce();
    expect(prismaMock.mailMessage.findFirst).toHaveBeenLastCalledWith({
      where: { mailboxId: "box1", messageId: key },
      select: { id: true },
    });
  });

  it("параллельный ретрай: P2002 отвечает deduped, а не 500", async () => {
    delete process.env.MAIL_WEBHOOK_SECRET;
    process.env.MAIL_INGEST_SECRET = "shared-secret";
    prismaMock.mailMessage.create.mockRejectedValue(Object.assign(new Error("unique"), { code: "P2002" }));
    const mod = await import("@/app/api/mail/ingest/route");
    const res = await mod.POST(req(payload, { "x-mail-secret": "shared-secret" }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deduped: true });
  });
});
