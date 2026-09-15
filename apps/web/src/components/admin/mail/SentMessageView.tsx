"use client";
import React, { useEffect, useState } from "react";
import { formatBytes } from "@/lib/mailAttachments";

export function SentMessageView({ messageId }: { messageId: string }) {
  const [msg, setMsg] = useState<any>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    fetch(`/api/admin/mail/message/${messageId}/view`).then((r) => r.json()).then((d) => { if (d?.message) setMsg(d.message); else setError(d?.error || "\u041d\u0435 \u043d\u0430\u0439\u0434\u0435\u043d\u043e"); }).catch(() => setError("\u041e\u0448\u0438\u0431\u043a\u0430 \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438"));
  }, [messageId]);
  if (error) return <div style={{ color: "#b91c1c" }}>{error}</div>;
  if (!msg) return <div>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026</div>;
  const atts = (msg.attachments || []).filter((a: any) => !a.inline);
  return (
    <div style={{ maxWidth: 760, fontFamily: "system-ui, Arial, sans-serif" }}>
      <h2 style={{ fontSize: 18 }}>{msg.subject}</h2>
      <div style={{ fontSize: 13, color: "#4b4b63", marginBottom: 12, lineHeight: 1.6 }}>
        <div><b>\u041e\u0442:</b> {msg.fromName ? `${msg.fromName} <${msg.fromAddr}>` : msg.fromAddr}</div>
        <div><b>\u041a\u043e\u043c\u0443:</b> {msg.toAddr}</div>
        {msg.ccAddr && <div><b>CC:</b> {msg.ccAddr}</div>}
        {msg.bccAddr && <div><b>BCC:</b> {msg.bccAddr}</div>}
        <div><b>\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u043b:</b> {msg.sentByName} \u00b7 {new Date(msg.sentAt).toLocaleString("ru-RU")}</div>
        {msg.templateKey && <div><b>\u0428\u0430\u0431\u043b\u043e\u043d:</b> {msg.templateKey}</div>}
      </div>
      <iframe title="sent-message" srcDoc={msg.bodyHtml} style={{ width: "100%", height: 560, border: "1px solid #e5e7eb", borderRadius: 8, background: "#fff" }} />
      {atts.length > 0 && (<div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>\u0412\u043b\u043e\u0436\u0435\u043d\u0438\u044f</div>
        {atts.map((a: any) => (<div key={a.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 10px", background: "#fafafc", borderRadius: 6, marginBottom: 4 }}>
          <span>{a.name} <span style={{ color: "#8a8aa0" }}>({formatBytes(a.size)})</span></span>
          <span><a href={`${a.url}?inline=1`} target="_blank" rel="noreferrer" style={{ color: "#7c3aed", marginRight: 12 }}>\u041e\u0442\u043a\u0440\u044b\u0442\u044c</a><a href={a.url} style={{ color: "#7c3aed" }}>\u0421\u043a\u0430\u0447\u0430\u0442\u044c</a></span>
        </div>))}
      </div>)}
    </div>
  );
}
export default SentMessageView;
