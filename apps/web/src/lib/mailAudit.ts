/** PROJECT-MAIL: структурный журнал отправок (MailSendLog). */
import prisma from "@/lib/prisma";

export interface MailSendLogInput {
  userId?: string | null; userName: string; fromAddress: string; fromName?: string;
  to: string[]; cc?: string[]; bcc?: string[]; subject: string;
  attachmentCount: number; templateKey?: string; messageDbId?: string;
}

export async function logMailSend(input: MailSendLogInput): Promise<void> {
  try {
    await (prisma as any).mailSendLog.create({
      data: {
        userId: input.userId || null, userName: input.userName, fromAddress: input.fromAddress,
        fromName: input.fromName || null, toAddr: input.to.join(", "),
        ccAddr: input.cc && input.cc.length ? input.cc.join(", ") : null,
        bccAddr: input.bcc && input.bcc.length ? input.bcc.join(", ") : null,
        subject: input.subject, attachmentCount: input.attachmentCount,
        templateKey: input.templateKey || null, messageId: input.messageDbId || null,
      },
    });
  } catch (e) {
    console.warn("[mail] лог отправки не записан:", (e as Error)?.message);
    console.info(`[mail] SEND by ${input.userName} from ${input.fromAddress} to ${input.to.join(", ")} att=${input.attachmentCount}`);
  }
}
