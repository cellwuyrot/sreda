"use client";
import React, { useEffect, useMemo, useRef, useState } from "react";
import RecipientsInput from "./RecipientsInput";
import RichTextEditor from "./RichTextEditor";
import EmailPreview from "./EmailPreview";
import { validateRecipients } from "@/lib/mailRecipients";
import { checkAttachmentSet, formatBytes, acceptAttribute, checkAttachment } from "@/lib/mailAttachments";
import { markdownToHtml } from "@/lib/mailMarkdown";
import { buildEmailHtml, extractVariables, applyVariables } from "@/lib/mailLayout";

interface Mailbox { address: string; localPart: string; label: string; }
interface Template { key: string; name: string; subject: string; format: string; body: string; }
interface ReplyTo { messageId?: string; subject?: string; quotedHtml?: string; to?: string[]; cc?: string[]; }
type FileItem = { name: string; mime: string; size: number; content: string; cid?: string };

function fileToBase64(file: File): Promise<string> {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] || ""); r.onerror = rej; r.readAsDataURL(file); });
}

export function MailComposer({ mailboxes, templates, replyTo, defaultMailbox, onSent }: { mailboxes: Mailbox[]; templates: Template[]; replyTo?: ReplyTo; defaultMailbox?: string; onSent?: (id?: string) => void }) {
  const [mailbox, setMailbox] = useState(defaultMailbox || mailboxes[0]?.localPart || "");
  const [fromName, setFromName] = useState("");
  const [to, setTo] = useState<string[]>(replyTo?.to || []);
  const [cc, setCc] = useState<string[]>(replyTo?.cc || []);
  const [bcc, setBcc] = useState<string[]>([]);
  const [showCc, setShowCc] = useState<boolean>(!!(replyTo?.cc && replyTo.cc.length));
  const [subject, setSubject] = useState(replyTo?.subject || "");
  const [format, setFormat] = useState<"markdown" | "html">("html");
  const [body, setBody] = useState(replyTo?.quotedHtml ? `<p></p><blockquote>${replyTo.quotedHtml}</blockquote>` : "");
  const [attachments, setAttachments] = useState<FileItem[]>([]);
  const [inlineImages, setInlineImages] = useState<FileItem[]>([]);
  const [useSignature, setUseSignature] = useState(true);
  const [signatureHtml, setSignatureHtml] = useState("");
  const [templateKey, setTemplateKey] = useState("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [view, setView] = useState<"editor" | "preview">("editor");
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");
  const [dragOver, setDragOver] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const draftTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const finalized = useRef(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const currentAddress = mailboxes.find((m) => m.localPart === mailbox)?.address || "";

  useEffect(() => {
    if (!mailbox || finalized.current) return;
    fetch(`/api/admin/mail/${encodeURIComponent(mailbox)}/signature`).then((r) => r.json()).then((d) => {
      if (d?.signature) { setSignatureHtml(d.signature.html || ""); setUseSignature(d.signature.enabled !== false); } else setSignatureHtml("");
    }).catch(() => {});
    fetch(`/api/admin/mail/${encodeURIComponent(mailbox)}/draft`).then((r) => r.json()).then((d) => {
      const dr = d?.draft; if (!dr) return;
      if (dr.fromName) setFromName(dr.fromName);
      if (dr.subject) setSubject(dr.subject);
      if (dr.body) setBody(dr.body);
      if (dr.format) setFormat(dr.format);
      if (dr.toAddr) setTo(dr.toAddr.split(",").map((s: string) => s.trim()).filter(Boolean));
      if (dr.ccAddr) { setCc(dr.ccAddr.split(",").map((s: string) => s.trim()).filter(Boolean)); setShowCc(true); }
      if (dr.bccAddr) { setBcc(dr.bccAddr.split(",").map((s: string) => s.trim()).filter(Boolean)); setShowCc(true); }
      if (dr.templateKey) setTemplateKey(dr.templateKey);
    }).catch(() => {});
  }, [mailbox]);

  useEffect(() => {
    if (!mailbox || finalized.current) return;
    if (draftTimer.current) clearTimeout(draftTimer.current);
    draftTimer.current = setTimeout(() => {
      fetch(`/api/admin/mail/${encodeURIComponent(mailbox)}/draft`, { method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, to: to.join(", "), cc: cc.join(", "), bcc: bcc.join(", "), subject, format, body, templateKey, attachmentsMeta: attachments.map((a) => ({ name: a.name, size: a.size, mime: a.mime })) }) }).catch(() => {});
    }, 1500);
    return () => { if (draftTimer.current) clearTimeout(draftTimer.current); };
  }, [mailbox, fromName, to, cc, bcc, subject, format, body, templateKey, attachments]);

  const applyTemplate = (key: string) => {
    setTemplateKey(key);
    const t = templates.find((x) => x.key === key);
    if (t) {
      setSubject(t.subject || ""); setBody(t.body || ""); setFormat(t.format === "markdown" ? "markdown" : "html");
      const vars = Array.from(new Set([...extractVariables(t.subject || ""), ...extractVariables(t.body || "")]));
      const vo: Record<string, string> = {}; vars.forEach((v) => (vo[v] = "")); setVariables(vo);
    }
  };

  const addFiles = async (files: FileList | File[], inline: boolean) => {
    const arr = Array.from(files); const out: FileItem[] = [];
    for (const f of arr) {
      const item: FileItem = { name: f.name, mime: f.type || "application/octet-stream", size: f.size, content: await fileToBase64(f) };
      if (inline) { item.cid = `img${Date.now()}${out.length}@trioz`; out.push(item); }
      else { const c = checkAttachment({ name: f.name, size: f.size, mime: f.type }); if (!c.ok) { setError(c.error || "Файл отклонён"); continue; } out.push(item); }
    }
    if (inline) {
      setInlineImages((p) => [...p, ...out]);
      if (format === "html" && out.length) {
        setBody((current) => `${current}${current ? "<p></p>" : ""}${out.map((a) => `<p><img src="cid:${a.cid}" alt="${a.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}" style="max-width:100%;height:auto;" /></p>`).join("")}`);
      }
    } else { const next = [...attachments, ...out]; const check = checkAttachmentSet(next.map((a) => ({ name: a.name, size: a.size, mime: a.mime }))); if (!check.ok) { setError(check.error || "Ошибка вложений"); return; } setAttachments(next); }
  };

  const previewHtml = useMemo(() => {
    const inner = format === "markdown" ? markdownToHtml(applyVariables(body, variables)) : applyVariables(body, variables);
    return buildEmailHtml({ bodyHtml: inner, subject: applyVariables(subject, variables), signatureHtml: useSignature ? signatureHtml : "" });
  }, [format, body, subject, variables, useSignature, signatureHtml]);

  const doSend = async () => {
    setError("");
    const rc = validateRecipients({ to, cc, bcc });
    if (!rc.ok) { setError(rc.error || "Проверьте получателей"); setConfirming(false); return; }
    if (!subject.trim()) { setError("Укажите тему письма"); setConfirming(false); return; }
    const setCheck = checkAttachmentSet([...attachments, ...inlineImages].map((a) => ({ name: a.name, size: a.size, mime: a.mime })));
    if (!setCheck.ok) { setError(setCheck.error || "Ошибка вложений"); setConfirming(false); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/mail/${encodeURIComponent(mailbox)}/send`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, to, cc, bcc, subject, format, body, attachments, inlineImages, templateKey: templateKey || undefined, variables, replyToMessageId: replyTo?.messageId }) });
      const d = await res.json().catch(() => null);
      if (!res.ok || !d?.ok || !d?.accepted) {
        setError(d?.error || "Сервер не подтвердил отправку");
        setSending(false); setConfirming(false); return;
      }
      finalized.current = true;
      if (draftTimer.current) {
        clearTimeout(draftTimer.current);
        draftTimer.current = null;
      }
      // SMTP already accepted the message. Finalize the draft before closing;
      // never clear fields first, otherwise autosave can recreate an empty draft.
      const draftResponse = await fetch(`/api/admin/mail/${encodeURIComponent(mailbox)}/draft`, { method: "DELETE" }).catch(() => null);
      if (draftResponse && !draftResponse.ok) {
        setNotice("Письмо отправлено; черновик не удалось удалить");
      }
      setConfirming(false);
      onSent?.(d.id);
    } catch (e: unknown) { setError(e instanceof Error ? e.message : "Ошибка сети"); }
    finally { setSending(false); }
  };

  const totalSize = [...attachments, ...inlineImages].reduce((s, a) => s + a.size, 0);
  const templateVars = Object.keys(variables);

  const control = "h-10 w-full rounded-lg border border-neutral-200 bg-white px-3 text-sm text-neutral-900 outline-none transition placeholder:text-neutral-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-500/10 dark:border-white/10 dark:bg-neutral-950/50 dark:text-white dark:placeholder:text-gray-500 dark:focus:border-cyan-400/60 dark:focus:ring-cyan-400/10";
  const segmented = "inline-flex overflow-hidden rounded-lg border border-neutral-200 bg-white dark:border-white/10 dark:bg-neutral-950/50";
  const segment = "px-3 py-2 text-xs font-medium transition-colors";

  return (
    <div className="w-full max-w-[900px] text-neutral-900 dark:text-white">
      <div className="mb-5 flex items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold tracking-tight">Новое письмо</h2>
          <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">Отправка через выбранный почтовый ящик TrioZ.</p>
        </div>
        <div className="hidden rounded-lg border border-neutral-200 px-3 py-1.5 text-[11px] text-neutral-500 dark:border-white/10 dark:text-gray-400 sm:block">
          {currentAddress || "Почтовый ящик не выбран"}
        </div>
      </div>

      {error && <div className="mb-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700 dark:border-red-500/20 dark:bg-red-500/10 dark:text-red-300">{error}</div>}
      {notice && <div className="mb-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-700 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">{notice}</div>}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-gray-300">Почтовый ящик</label>
          <select value={mailbox} onChange={(e) => setMailbox(e.target.value)} className={control}>
            {mailboxes.map((m) => <option key={m.localPart} value={m.localPart}>{m.label} — {m.address}</option>)}
          </select>
        </div>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-gray-300">Имя отправителя</label>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Поддержка TrioZ" className={control} />
        </div>
      </div>

      <div className="mt-2 mb-4 flex items-center gap-1.5 text-[11px] text-neutral-500 dark:text-gray-400">
        <span>Адрес отправителя:</span>
        <span className="font-medium text-neutral-700 dark:text-gray-200">{currentAddress}</span>
        <span>· изменить нельзя</span>
      </div>

      <RecipientsInput label="Кому" values={to} onChange={setTo} />
      {!showCc && (
        <button type="button" onClick={() => setShowCc(true)} className="mb-4 rounded-md px-1 text-xs font-medium text-violet-600 hover:text-violet-700 dark:text-cyan-400 dark:hover:text-cyan-300">
          + CC / BCC
        </button>
      )}
      {showCc && (
        <div className="mb-1">
          <RecipientsInput label="CC" values={cc} onChange={setCc} />
          <RecipientsInput label="BCC" values={bcc} onChange={setBcc} />
        </div>
      )}

      {templates.length > 0 && (
        <div className="mb-4">
          <label className="mb-1.5 block text-xs font-medium text-neutral-600 dark:text-gray-300">Шаблон</label>
          <select value={templateKey} onChange={(e) => applyTemplate(e.target.value)} className={control}>
            <option value="">Без шаблона</option>
            {templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}
          </select>
        </div>
      )}

      {templateVars.length > 0 && (
        <div className="mb-4 rounded-lg border border-violet-200 bg-violet-50/60 p-3 dark:border-cyan-500/15 dark:bg-cyan-500/5">
          <div className="mb-2 text-xs font-semibold text-neutral-700 dark:text-gray-200">Переменные шаблона</div>
          <div className="space-y-2">
            {templateVars.map((v) => (
              <div key={v} className="grid gap-2 sm:grid-cols-[120px_1fr] sm:items-center">
                <code className="rounded-md bg-white/70 px-2 py-1 text-[11px] text-neutral-600 dark:bg-white/5 dark:text-gray-300">{"{{" + v + "}}"}</code>
                <input value={variables[v]} onChange={(e) => setVariables((p) => ({ ...p, [v]: e.target.value }))} className={control} />
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mb-4">
        <div className="mb-1.5 flex items-center justify-between gap-2">
          <label className="block text-xs font-medium text-neutral-600 dark:text-gray-300">Тема</label>
          <span className="text-[10px] text-neutral-400 dark:text-gray-500">{subject.length} / 255</span>
        </div>
        <input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 255))} className={control} />
      </div>

      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className={segmented}>
          <button type="button" onClick={() => setView("editor")} className={`${segment} ${view === "editor" ? "bg-violet-600 text-white dark:bg-cyan-500 dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-50 dark:text-gray-300 dark:hover:bg-white/5"}`}>Редактор</button>
          <button type="button" onClick={() => setView("preview")} className={`${segment} ${view === "preview" ? "bg-violet-600 text-white dark:bg-cyan-500 dark:text-neutral-950" : "text-neutral-600 hover:bg-neutral-50 dark:text-gray-300 dark:hover:bg-white/5"}`}>Предпросмотр</button>
        </div>
        <div className={segmented}>
          <button type="button" onClick={() => setFormat("html")} className={`${segment} ${format === "html" ? "bg-neutral-100 text-neutral-900 dark:bg-white/10 dark:text-white" : "text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"}`}>Visual</button>
          <button type="button" onClick={() => setFormat("markdown")} className={`${segment} ${format === "markdown" ? "bg-neutral-100 text-neutral-900 dark:bg-white/10 dark:text-white" : "text-neutral-500 hover:text-neutral-800 dark:text-gray-400 dark:hover:text-white"}`}>Markdown</button>
        </div>
        {view === "preview" && (
          <div className={segmented}>
            <button type="button" onClick={() => setDevice("desktop")} className={`${segment} ${device === "desktop" ? "bg-neutral-100 text-neutral-900 dark:bg-white/10 dark:text-white" : "text-neutral-500 dark:text-gray-400"}`}>Desktop</button>
            <button type="button" onClick={() => setDevice("mobile")} className={`${segment} ${device === "mobile" ? "bg-neutral-100 text-neutral-900 dark:bg-white/10 dark:text-white" : "text-neutral-500 dark:text-gray-400"}`}>Mobile</button>
          </div>
        )}
      </div>

      {view === "editor" ? (
        format === "markdown" ? (
          <textarea value={body} onChange={(e) => setBody(e.target.value)} className={`${control} min-h-[280px] resize-y py-3 font-mono leading-6`} placeholder="# Заголовок..." />
        ) : (
          <RichTextEditor html={body} onChange={setBody} />
        )
      ) : (
        <EmailPreview fullHtml={previewHtml} device={device} />
      )}

      <label className="mt-3 mb-4 flex items-center gap-2 text-sm text-neutral-700 dark:text-gray-300">
        <input type="checkbox" checked={useSignature} onChange={(e) => setUseSignature(e.target.checked)} className="h-4 w-4 rounded border-neutral-300 accent-violet-600 dark:border-white/20 dark:accent-cyan-400" />
        Добавить подпись ящика
      </label>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <button type="button" onClick={() => imgInput.current?.click()} className="rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs font-medium text-neutral-700 transition hover:border-violet-300 hover:text-violet-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300 dark:hover:border-cyan-400/40 dark:hover:text-cyan-300">
          Вставить изображение в тело
        </button>
        <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files, true)} />
        {inlineImages.length > 0 && <span className="text-xs text-neutral-500 dark:text-gray-400">{inlineImages.length} изобр.</span>}
      </div>

      <div
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files, false); }}
        className={`mb-4 rounded-xl border border-dashed p-4 text-center transition ${dragOver ? "border-violet-400 bg-violet-50/80 dark:border-cyan-400/60 dark:bg-cyan-500/5" : "border-neutral-200 bg-neutral-50 dark:border-white/10 dark:bg-white/[0.02]"}`}
      >
        <p className="m-0 text-sm text-neutral-500 dark:text-gray-400">
          Перетащите файлы сюда или {" "}
          <button type="button" onClick={() => fileInput.current?.click()} className="font-medium text-violet-600 hover:text-violet-700 dark:text-cyan-400 dark:hover:text-cyan-300">выберите</button>
        </p>
        <input ref={fileInput} type="file" multiple hidden accept={acceptAttribute()} onChange={(e) => e.target.files && addFiles(e.target.files, false)} />
        {attachments.length > 0 && (
          <div className="mt-3 space-y-1 text-left">
            {attachments.map((a, i) => (
              <div key={i} className="flex items-center justify-between gap-3 rounded-lg border border-neutral-200 bg-white px-3 py-2 text-xs dark:border-white/10 dark:bg-white/[0.03]">
                <span className="min-w-0 truncate text-neutral-700 dark:text-gray-200">{a.name} <span className="text-neutral-400 dark:text-gray-500">({formatBytes(a.size)})</span></span>
                <button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} className="shrink-0 text-red-600 hover:text-red-700 dark:text-red-400">Удалить</button>
              </div>
            ))}
            <div className="pt-1 text-[11px] text-neutral-400 dark:text-gray-500">Всего: {formatBytes(totalSize)}</div>
          </div>
        )}
      </div>

      <button type="button" onClick={() => setConfirming(true)} disabled={sending} className="inline-flex items-center justify-center rounded-lg bg-violet-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-violet-700 disabled:cursor-not-allowed disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400">
        {sending ? "Отправка..." : "Отправить"}
      </button>

      {confirming && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm">
          <div className="w-full max-w-lg rounded-2xl border border-neutral-200 bg-white p-5 shadow-2xl dark:border-white/10 dark:bg-neutral-900">
            <div className="mb-4">
              <h3 className="text-base font-semibold text-neutral-900 dark:text-white">Подтверждение отправки</h3>
              <p className="mt-1 text-xs text-neutral-500 dark:text-gray-400">Проверьте получателей и тему перед отправкой.</p>
            </div>
            <div className="space-y-2 rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm text-neutral-700 dark:border-white/10 dark:bg-white/[0.03] dark:text-gray-300">
              <div><b className="text-neutral-900 dark:text-white">От:</b> {fromName ? `${fromName} <${currentAddress}>` : currentAddress}</div>
              <div><b className="text-neutral-900 dark:text-white">Кому:</b> {to.join(", ") || "—"}</div>
              {cc.length > 0 && <div><b className="text-neutral-900 dark:text-white">CC:</b> {cc.join(", ")}</div>}
              {bcc.length > 0 && <div><b className="text-neutral-900 dark:text-white">BCC:</b> {bcc.join(", ")}</div>}
              <div><b className="text-neutral-900 dark:text-white">Тема:</b> {subject || "—"}</div>
              <div><b className="text-neutral-900 dark:text-white">Вложений:</b> {attachments.length + inlineImages.length}</div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setConfirming(false)} className="rounded-lg border border-neutral-200 bg-white px-4 py-2 text-sm font-medium text-neutral-700 hover:bg-neutral-50 dark:border-white/10 dark:bg-neutral-950/50 dark:text-gray-300 dark:hover:bg-white/5">Отмена</button>
              <button type="button" onClick={doSend} disabled={sending} className="rounded-lg bg-violet-600 px-4 py-2 text-sm font-semibold text-white hover:bg-violet-700 disabled:opacity-50 dark:bg-cyan-500 dark:text-neutral-950 dark:hover:bg-cyan-400">{sending ? "Отправка..." : "Отправить"}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
export default MailComposer;
