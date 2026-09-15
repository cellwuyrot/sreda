"use client";
/* PROJECT-MAIL: просмотр отправленного письма. */
import { useEffect, useState } from "react";
import { formatBytes } from "@/lib/mailAttachments";

interface Att { id: string; name: string; mime: string; size: number; inline: boolean; url: string; }
interface Msg {
  id: string; fromAddr: string; fromName?: string | null; toAddr: string;
  ccAddr?: string | null; bccAddr?: string | null; subject: string; bodyHtml: string;
  templateKey?: string | null; sentByName?: string | null; sentAt: string; attachments: Att[];
}

export default function SentMessageView({ messageId, onClose }: { messageId: string; onClose?: () => void }) {
  const [msg, setMsg] = useState<Msg | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/admin/mail/message/${messageId}/view`).then((r) => r.json())
      .then((d) => { if (alive) { if (d.message) setMsg(d.message); else setError(d.error || "Не найдено"); } })
      .catch(() => alive && setError("Ошибка загрузки"));
    return () => { alive = false; };
  }, [messageId]);
  if (error) return <div className="p-4 text-sm text-red-300">{error}</div>;
  if (!msg) return <div className="p-4 text-sm text-white/50">Загрузка…</div>;
  const files = msg.attachments.filter((a) => !a.inline);
  return (
    <div className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="text-sm text-white/80">
          <div className="text-base font-semibold text-white">{msg.subject}</div>
          <div className="mt-1 text-xs text-white/50">От: {msg.fromName ? `${msg.fromName} <${msg.fromAddr}>` : msg.fromAddr}</div>
          <div className="text-xs text-white/50">Кому: {msg.toAddr}</div>
          {msg.ccAddr ? <div className="text-xs text-white/50">CC: {msg.ccAddr}</div> : null}
          {msg.bccAddr ? <div className="text-xs text-white/50">BCC: {msg.bccAddr}</div> : null}
          <div className="text-xs text-white/40">{new Date(msg.sentAt).toLocaleString("ru-RU")} · {msg.sentByName || "admin"}{msg.templateKey ? ` · шаблон: ${msg.templateKey}` : ""}</div>
        </div>
        {onClose ? <button className="rounded px-2 py-1 text-xs text-white/60 hover:bg-white/10" onClick={onClose}>Закрыть</button> : null}
      </div>
      <iframe title="sent-mail" srcDoc={msg.bodyHtml} sandbox="" style={{ width: "100%", height: 480, border: "1px solid rgba(255,255,255,.1)", borderRadius: 8, background: "#fff" }} />
      {files.length > 0 && (
        <div className="space-y-1">
          <div className="text-xs text-white/50">Вложения ({files.length})</div>
          {files.map((a) => (
            <div key={a.id} className="flex items-center justify-between rounded-lg border border-white/10 bg-black/20 px-3 py-1.5 text-xs text-white/80">
              <span>{a.name} · {formatBytes(a.size)}</span>
              <span className="flex gap-2">
                <a className="text-violet-300 hover:underline" href={`${a.url}?inline=1`} target="_blank" rel="noreferrer">Открыть</a>
                <a className="text-violet-300 hover:underline" href={a.url}>Скачать</a>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
