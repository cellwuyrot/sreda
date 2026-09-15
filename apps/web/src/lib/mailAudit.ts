import prisma from "@/lib/prisma";

export interface MailSendLogInput {
  userId?: string;
  userName: string;
  fromAddress: string;
  fromName?: string;
  to: string[];
  cc?: string[];
  bcc?: string[];
  subject: string;
  attachmentCount: number;
  templateKey?: string;
  messageDbId?: string;
}

export async function logMailSend(input: MailSendLogInput): Promise<void> {
  try {
    await prisma.mailSendLog.create({
      data: {
        userId: input.userId || null,
        userName: input.userName,
        fromAddress: input.fromAddress,
        fromName: input.fromName || null,
        toAddr: input.to.join(", "),
        ccAddr: input.cc?.length ? input.cc.join(", ") : null,
        bccAddr: input.bcc?.length ? input.bcc.join(", ") : null,
        subject: input.subject,
        attachmentCount: input.attachmentCount,
        templateKey: input.templateKey || null,
        messageId: input.messageDbId || null,
      },
    });
  } catch (error: unknown) {
    console.log("[mail-audit]", JSON.stringify({ ...input, to: input.to.join(","), error: error instanceof Error ? error.message : String(error), at: new Date().toISOString() }));
  }
}
