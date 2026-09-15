"use client";
/* PROJECT-MAIL: композер письма — получатели, тема, Rich Text/Markdown,
   вложения, подпись, шаблоны, предпросмотр, черновики, отправка. */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import RecipientsInput from "./RecipientsInput";
import RichTextEditor from "./RichTextEditor";
import EmailPreview from "./EmailPreview";
import { parseRecipients, validateRecipients } from "@/lib/mailRecipients";
import { acceptAttribute, checkAttachmentSet, formatBytes, type AttachmentMeta } from "@/lib/mailAttachments";
import { markdownToHtml, htmlToText } from "@/lib/mailMarkdown";
import { buildEmailHtml, extractVariables, applyVariables } from "@/lib/mailLayout";

export interface ComposerMailbox { localPart: string; address: string; label?: string; }
export interface ComposerTemplate { key: string; name: string; subject: string; format: string; body: string; }
export interface ReplyContext { messageId: string; subject: string; quotedHtml: string; to: string[]; cc?: string[]; }

interface Props {
  mailboxes: ComposerMailbox[];
  templates?: ComposerTemplate[];
  replyTo?: ReplyContext | null;
  initialMailbox?: string;
  onSent?: (result: { id?: string; messageId?: string }) => void;
  onCancel?: () => void;
}

interface PendingFile { name: string; mime: string; size: number; content: string; cid?: string; }

const MAX_SUBJECT = 255;

function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => { const s = String(r.result || ""); resolve(s.slice(s.indexOf(",") + 1)); };
    r.onerror = reject; r.readAsDataURL(file);
  });
}

export default function MailComposer({ mailboxes, templates, replyTo, initialMailbox, onSent, onCancel }: Props) {
  const [localPart, setLocalPart] = useState(initialMailbox || mailboxes[0]?.localPart || "");
  const [fromName, setFromName] = useState("");
  const [to, setTo] = useState<string[]>(replyTo?.to || []);
  const [cc, setCc] = useState<string[]>(replyTo?.cc || []);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCcBcc, setShowCcBcc] = useState<boolean>(!!(replyTo?.cc && replyTo.cc.length));
  const [subject, setSubject] = useState(replyTo?.subject ? (replyTo.subject.startsWith("Re:") ? replyTo.subject : `Re: ${replyTo.subject}`) : "");
  const [format, setFormat] = useState<"html" | "markdown">("html");
  const [body, setBody] = useState(replyTo?.quotedHtml ? `<p><br /></p><blockquote>${replyTo.quotedHtml}</blockquote>` : "");
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [signatureHtml, setSignatureHtml] = useState("");
  const [templateKey, setTemplateKey] = useState<string>("");
  const [vars, setVars] = useState<Record<string, string>>({});
  const [tab, setTab] = useState<"editor" | "preview">("editor");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [sending, setSending] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const currentMailbox = mailboxes.find((m) => m.localPart === localPart);

  /* Подпись и черновик по выбранному ящику. */
  useEffect(() => {
    if (!localPart) return;
    let alive = true;
    fetch(`/api/admin/mail/${localPart}/signature`).then((r) => r.json())
      .then((d) => { if (alive && d && typeof d.html === "string") setSignatureHtml(d.enabled === false ? "" : d.html); }).catch(() => {});
    if (!replyTo) {
      fetch(`/api/admin/mail/${localPart}/draft`).then((r) => r.json())
        .then((d) => {
          if (!alive || !d || !d.draft) return;
          const dr = d.draft;
          setFromName(dr.fromName || ""); setTo(parseRecipients(dr.toAddr)); setCc(parseRecipients(dr.ccAddr)); setBcc(parseRecipients(dr.bccAddr));
          if (dr.ccAddr || dr.bccAddr) setShowCcBcc(true);
          setSubject(dr.subject || ""); setFormat(dr.format === "markdown" ? "markdown" : "html"); setBody(dr.body || ""); setTemplateKey(dr.templateKey || "");
        }).catch(() => {});
    }
    return () => { alive = false; };
  }, [localPart, replyTo]);

  /* Автосохранение черновика. */
  const draftPayload = useMemo(() => ({
    fromName, toAddr: to.join(", "), ccAddr: cc.join(", "), bccAddr: bcc.join(", "),
    subject, format, body, templateKey: templateKey || null,
  }), [fromName, to, cc, bcc, subject, format, body, templateKey]);

  useEffect(() => {
    if (replyTo || !localPart) return;
    if (!subject && to.length === 0 && !body) return;
    const id = setTimeout(() => {
      fetch(`/api/admin/mail/${localPart}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draftPayload) })
        .then(() => setSavedAt(new Date().toLocaleTimeString("ru-RU"))).catch(() => {});
    }, 1500);
    return () => clearTimeout(id);
  }, [draftPayload, localPart, replyTo, subject, to.length, body]);

  const detectedVars = useMemo(() => extractVariables(`${subject}\n${body}`), [subject, body]);

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = (templates || []).find((x) => x.key === key);
    if (!t) return;
    setSubject(t.subject || subject);
    setFormat(t.format === "markdown" ? "markdown" : "html");
    setBody(t.body || "");
  };

  const addFiles = useCallback(async (fileList: FileList | File[]) => {
    const arr = Array.from(fileList);
    const pending: PendingFile[] = [];
    for (const f of arr) pending.push({ name: f.name, mime: f.type || "application/octet-stream", size: f.size, content: await readFileAsBase64(f) });
    const next = [...files, ...pending];
    const check = checkAttachmentSet(next.map((p): AttachmentMeta => ({ name: p.name, size: p.size, mime: p.mime })));
    if (!check.ok) { setError(check.error); return; }
    setError(null); setFiles(next);
  }, [files]);

  const bodyHtml = useMemo(() => (format === "markdown" ? markdownToHtml(body) : body), [format, body]);
  const fullHtml = useMemo(() => {
    const withVars = applyVariables(bodyHtml, vars);
    return buildEmailHtml({ bodyHtml: withVars, subject: applyVariables(subject, vars), signatureHtml });
  }, [bodyHtml, vars, subject, signatureHtml]);

  const doSend = async () => {
    setError(null);
    const rcpt = validateRecipients({ to, cc, bcc });
    if (!rcpt.ok) { setError(rcpt.error); setConfirm(false); return; }
    if (!subject.trim()) { setError("Укажите тему письма"); setConfirm(false); return; }
    if (subject.length > MAX_SUBJECT) { setError(`Тема длиннее ${MAX_SUBJECT} символов`); setConfirm(false); return; }
    if (htmlToText(bodyHtml).length === 0 && files.length === 0) { setError("Письмо пустое"); setConfirm(false); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/mail/${localPart}/send`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromName: fromName || undefined, to: rcpt.to, cc: rcpt.cc, bcc: rcpt.bcc,
          subject, format, body,
          attachments: files.map((f) => ({ name: f.name, mime: f.mime, size: f.size, content: f.content })),
          inlineImages: [], templateKey: templateKey || undefined,
          replyToMessageId: replyTo?.messageId, variables: vars,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || data.ok === false) { setError(data.error || "Не удалось отправить"); setConfirm(false); return; }
      setConfirm(false);
      onSent?.({ id: data.id, messageId: data.messageId });
    } catch {
      setError("Сетевая ошибка при отправке");
    } finally { setSending(false); }
  };

  const inputCls = "w-full rounded-lg border border-white/10 bg-black/20 px-2.5 py-1.5 text-sm text-white/85 outline-none focus:border-white/25";

  return (
    <div className="space-y-3">
      {error && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">{error}</div>}
      <div className="grid gap-2 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-xs text-white/50">Отправитель</label>
          <select className={inputCls} value={localPart} onChange={(e) => setLocalPart(e.target.value)}>
            {mailboxes.map((m) => <option key={m.localPart} value={m.localPart}>{m.label ? `${m.label} — ${m.address}` : m.address}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs text-white/50">Имя отправителя</label>
          <input className={inputCls} value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder={currentMailbox?.label || "TrioZ"} />
        </div>
      </div>
      <RecipientsInput label="Кому" values={to} onChange={setTo} />
      {!showCcBcc ? (
        <button type="button" className="text-xs text-violet-300 hover:underline" onClick={() => setShowCcBcc(true)}>+ Копия / Скрытая</button>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2">
          <RecipientsInput label="Копия (CC)" values={cc} onChange={setCc} />
          <RecipientsInput label="Скрытая (BCC)" values={bcc} onChange={setBcc} />
        </div>
      )}
      <div>
        <div className="mb-1 flex items-center justify-between">
          <label className="text-xs text-white/50">Тема</label>
          <span className={`text-[11px] ${subject.length > MAX_SUBJECT ? "text-red-300" : "text-white/40"}`}>{subject.length}/{MAX_SUBJECT}</span>
        </div>
        <input className={inputCls} value={subject} maxLength={MAX_SUBJECT + 50} onChange={(e) => setSubject(e.target.value)} />
      </div>
      {(templates && templates.length > 0) && (
        <div>
          <label className="mb-1 block text-xs text-white/50">Шаблон</label>
          <select className={inputCls} value={templateKey} onChange={(e) => applyTemplate(e.target.value)}>
            <option value="">Без шаблона</option>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </div>
      )}
      <div className="flex items-center gap-2">
        <div className="inline-flex overflow-hidden rounded-lg border border-white/10 text-xs">
          <button type="button" className={`px-3 py-1 ${tab === "editor" ? "bg-white/[0.12] text-white" : "text-white/50"}`} onClick={() => setTab("editor")}>Редактор</button>
          <button type="button" className={`px-3 py-1 ${tab === "preview" ? "bg-white/[0.12] text-white" : "text-white/50"}`} onClick={() => setTab("preview")}>Предпросмотр</button>
        </div>
        <label className="inline-flex items-center gap-1 text-xs text-white/60">
          <input type="checkbox" checked={format === "markdown"} onChange={(e) => setFormat(e.target.checked ? "markdown" : "html")} /> Markdown
        </label>
        {tab === "preview" && (
          <div className="ml-auto inline-flex overflow-hidden rounded-lg border border-white/10 text-xs">
            <button type="button" className={`px-2 py-1 ${device === "desktop" ? "bg-white/[0.12] text-white" : "text-white/50"}`} onClick={() => setDevice("desktop")}>Desktop</button>
            <button type="button" className={`px-2 py-1 ${device === "mobile" ? "bg-white/[0.12] text-white" : "text-white/50"}`} onClick={() => setDevice("mobile")}>Mobile</button>
          </div>
        )}
      </div>
      {tab === "editor" ? (
        format === "markdown"
          ? <textarea className={`${inputCls} min-h-[220px] font-mono`} value={body} onChange={(e) => setBody(e.target.value)} placeholder="# Заголовок&#10;Текст с **жирным** и [ссылкой](https://trioz.ru)" />
          : <RichTextEditor html={body} onChange={setBody} />
      ) : (
        <EmailPreview fullHtml={fullHtml} device={device} />
      )}
      {detectedVars.length > 0 && (
        <div className="rounded-lg border border-white/10 bg-black/20 p-2">
          <div className="mb-1 text-xs text-white/50">Переменные шаблона</div>
          <div className="grid gap-2 sm:grid-cols-2">
            {detectedVars.map((v) => (
              <div key={v} className="flex items-center gap-2">
                <span className="text-xs text-white/60">{`{{${v}}}`}</span>
                <input className={inputCls} value={vars[v] || ""} onChange={(e) => setVars((s) => ({ ...s, [v]: e.target.value }))} />
              </div>
            ))}
          </div>
        </div>
      )}
      <div
        className={`rounded-lg border border-dashed p-3 text-xs ${dragOver ? "border-violet-400 bg-violet-500/10" : "border-white/15"}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); }}
      >
        <div className="flex items-center justify-between">
          <span className="text-white/50">Перетащите файлы или</span>
          <button type="button" className="rounded-lg border border-white/10 px-2.5 py-1 text-white/70 hover:bg-white/5" onClick={() => fileInputRef.current?.click()}>Выбрать файлы</button>
          <input ref={fileInputRef} type="file" multiple hidden accept={acceptAttribute()} onChange={(e) => e.target.files && addFiles(e.target.files)} />
        </div>
        {files.length > 0 && (
          <div className="mt-2 space-y-1">
            {files.map((f, i) => (
              <div key={f.name + i} className="flex items-center justify-between rounded bg-black/20 px-2 py-1">
                <span className="text-white/80">{f.name} · {formatBytes(f.size)}</span>
                <button type="button" className="text-white/50 hover:text-white" onClick={() => setFiles(files.filter((_, j) => j !== i))}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center gap-2">
        <button type="button" disabled={sending} className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50" onClick={() => setConfirm(true)}>Отправить</button>
        {onCancel && <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5" onClick={onCancel}>Отмена</button>}
        <span className="ml-auto text-[11px] text-white/40">{savedAt ? `Черновик сохранён ${savedAt}` : ""}</span>
      </div>
      {confirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={() => setConfirm(false)}>
          <div className="w-full max-w-md rounded-xl border border-white/10 bg-neutral-900 p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-semibold text-white">Подтвердите отправку</div>
            <div className="mt-2 space-y-1 text-xs text-white/60">
              <div>От: {fromName ? `${fromName} <${currentMailbox?.address}>` : currentMailbox?.address}</div>
              <div>Кому: {to.join(", ") || "—"}</div>
              {cc.length > 0 && <div>CC: {cc.join(", ")}</div>}
              {bcc.length > 0 && <div>BCC: {bcc.join(", ")}</div>}
              <div>Тема: {subject || "—"}</div>
              <div>Вложений: {files.length}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="rounded-lg border border-white/10 px-3 py-1.5 text-sm text-white/70 hover:bg-white/5" onClick={() => setConfirm(false)}>Назад</button>
              <button type="button" disabled={sending} className="rounded-lg bg-violet-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-violet-500 disabled:opacity-50" onClick={doSend}>{sending ? "Отправка…" : "Отправить"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
