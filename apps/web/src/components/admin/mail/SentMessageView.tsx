"use client";
import React, { useEffect, useState } from "react";
import { formatBytes } from "@/lib/mailAttachments";

interface AttachmentView { id: string; name: string; size: number; inline: boolean; url: string; }
interface MessageView {
  subject: string;
  fromName?: string | null;
  fromAddr: string;
  toAddr: string;
  ccAddr?: string | null;
  bccAddr?: string | null;
  sentByName?: string | null;
  sentAt: string | Date;
  templateKey?: string | null;
  bodyHtml?: string | null;
  attachments?: AttachmentView[];
}

export function SentMessageView({ messageId }: { messageId: string }) {
  const [msg, setMsg] = useState<MessageView | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    fetch(`/api/admin/mail/message/${messageId}/view`)
      .then((r) => r.json() as Promise<{ message?: MessageView; error?: string }>)
      .then((d) => {
        if (d.message) setMsg(d.message);
        else setError(d.error || "Не найдено");
      })
      .catch(() => setError("Ошибка загрузки"));
  }, [messageId]);

  if (error) return <div style={{ color: "#b91c1c" }}>{error}</div>;
  if (!msg) return <div>Загрузка…</div>;

  const atts = (msg.attachments || []).filter((attachment) => !attachment.inline);
  return (
    <div style={{ maxWidth: 760, fontFamily: "system-ui, Arial, sans-serif" }}>
      <h2 style={{ fontSize: 18 }}>{msg.subject}</h2>
      <div style={{ fontSize: 13, color: "#4b4b63", marginBottom: 12, lineHeight: 1.6 }}>
        <div><b>От:</b> {msg.fromName ? `${msg.fromName} <${msg.fromAddr}>` : msg.fromAddr}</div>
        <div><b>Кому:</b> {msg.toAddr}</div>
        {msg.ccAddr && <div><b>CC:</b> {msg.ccAddr}</div>}
        {msg.bccAddr && <div><b>BCC:</b> {msg.bccAddr}</div>}
        <div><b>Отправил:</b> {msg.sentByName} · {new Date(msg.sentAt).toLocaleString("ru-RU")}</div>
        {msg.templateKey && <div><b>Шаблон:</b> {msg.templateKey}</div>}
      </div>
      <iframe title="sent-message" srcDoc={msg.bodyHtml || ""} style={{ width: "100%", height: 560, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }} />
      {atts.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>Вложения</div>
          {atts.map((attachment) => (
            <div key={attachment.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#fafafc", borderRadius: 6, marginBottom: 4 }}>
              <span>{attachment.name} <span style={{ color: "#8a8aa0" }}>({formatBytes(attachment.size)})</span></span>
              <span><a href={`${attachment.url}?inline=1`} target="_blank" rel="noreferrer" style={{ color: "#7c3aed", marginRight: 12 }}>Открыть</a><a href={attachment.url} style={{ color: "#7c3aed" }}>Скачать</a></span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default SentMessageView;
