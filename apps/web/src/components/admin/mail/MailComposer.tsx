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
  const draftTimer = useRef<any>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const imgInput = useRef<HTMLInputElement>(null);
  const currentAddress = mailboxes.find((m) => m.localPart === mailbox)?.address || "";

  useEffect(() => {
    if (!mailbox) return;
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
    if (!mailbox) return;
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
      else { const c = checkAttachment({ name: f.name, size: f.size, mime: f.type }); if (!c.ok) { setError(c.error || "\u0424\u0430\u0439\u043b \u043e\u0442\u043a\u043b\u043e\u043d\u0451\u043d"); continue; } out.push(item); }
    }
    if (inline) {
      setInlineImages((p) => [...p, ...out]);
      if (format === "html" && out.length) {
        setBody((current) => `${current}${current ? "<p></p>" : ""}${out.map((a) => `<p><img src="cid:${a.cid}" alt="${a.name.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")}" style="max-width:100%;height:auto;" /></p>`).join("")}`);
      }
    } else { const next = [...attachments, ...out]; const check = checkAttachmentSet(next.map((a) => ({ name: a.name, size: a.size, mime: a.mime }))); if (!check.ok) { setError(check.error || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0439"); return; } setAttachments(next); }
  };

  const previewHtml = useMemo(() => {
    const inner = format === "markdown" ? markdownToHtml(applyVariables(body, variables)) : applyVariables(body, variables);
    return buildEmailHtml({ bodyHtml: inner, subject: applyVariables(subject, variables), signatureHtml: useSignature ? signatureHtml : "" });
  }, [format, body, subject, variables, useSignature, signatureHtml]);

  const doSend = async () => {
    setError("");
    const rc = validateRecipients({ to, cc, bcc });
    if (!rc.ok) { setError(rc.error || "\u041f\u0440\u043e\u0432\u0435\u0440\u044c\u0442\u0435 \u043f\u043e\u043b\u0443\u0447\u0430\u0442\u0435\u043b\u0435\u0439"); setConfirming(false); return; }
    if (!subject.trim()) { setError("\u0423\u043a\u0430\u0436\u0438\u0442\u0435 \u0442\u0435\u043c\u0443 \u043f\u0438\u0441\u044c\u043c\u0430"); setConfirming(false); return; }
    const setCheck = checkAttachmentSet([...attachments, ...inlineImages].map((a) => ({ name: a.name, size: a.size, mime: a.mime })));
    if (!setCheck.ok) { setError(setCheck.error || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0432\u043b\u043e\u0436\u0435\u043d\u0438\u0439"); setConfirming(false); return; }
    setSending(true);
    try {
      const res = await fetch(`/api/admin/mail/${encodeURIComponent(mailbox)}/send`, { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fromName, to, cc, bcc, subject, format, body, attachments, inlineImages, templateKey: templateKey || undefined, variables, replyToMessageId: replyTo?.messageId }) });
      const d = await res.json();
      if (!res.ok) { setError(d?.error || "\u041e\u0448\u0438\u0431\u043a\u0430 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438"); setSending(false); setConfirming(false); return; }
      setNotice("\u041f\u0438\u0441\u044c\u043c\u043e \u043e\u0442\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u043e"); setConfirming(false);
      setTo([]); setCc([]); setBcc([]); setSubject(""); setBody(""); setAttachments([]); setInlineImages([]); setTemplateKey("");
    } catch (e: any) { setError(e?.message || "\u041e\u0448\u0438\u0431\u043a\u0430 \u0441\u0435\u0442\u0438"); } finally { setSending(false); }
  };

  const totalSize = [...attachments, ...inlineImages].reduce((s, a) => s + a.size, 0);
  const FIELD: React.CSSProperties = { width: "100%", padding: "8px 10px", border: "1px solid #d7d7e0", borderRadius: 8, fontSize: 14, fontFamily: "inherit" };
  const templateVars = Object.keys(variables);

  return (
    <div style={{ maxWidth: 860, fontFamily: "system-ui, Arial, sans-serif", color: "#1a1a2e" }}>
      <h2 style={{ fontSize: 20, marginBottom: 16 }}>\u041d\u043e\u0432\u043e\u0435 \u043f\u0438\u0441\u044c\u043c\u043e</h2>
      {error && <div style={{ padding: "8px 12px", background: "#fee2e2", color: "#b91c1c", borderRadius: 8, marginBottom: 12 }}>{error}</div>}
      {notice && <div style={{ padding: "8px 12px", background: "#dcfce7", color: "#166534", borderRadius: 8, marginBottom: 12 }}>{notice}</div>}
      <div style={{ display: "flex", gap: 12, marginBottom: 12, flexWrap: "wrap" }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>\u041f\u043e\u0447\u0442\u043e\u0432\u044b\u0439 \u044f\u0449\u0438\u043a</label>
          <select value={mailbox} onChange={(e) => setMailbox(e.target.value)} style={FIELD}>{mailboxes.map((m) => <option key={m.localPart} value={m.localPart}>{m.label} \u2014 {m.address}</option>)}</select>
        </div>
        <div style={{ flex: 1, minWidth: 220 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>\u0418\u043c\u044f \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u0435\u043b\u044f</label>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="\u041f\u043e\u0434\u0434\u0435\u0440\u0436\u043a\u0430 TrioZ" style={FIELD} />
        </div>
      </div>
      <div style={{ fontSize: 12, color: "#8a8aa0", marginBottom: 12 }}>\u0410\u0434\u0440\u0435\u0441 \u043e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u0435\u043b\u044f: <b>{currentAddress}</b> (\u0438\u0437\u043c\u0435\u043d\u0438\u0442\u044c \u043d\u0435\u043b\u044c\u0437\u044f)</div>
      <RecipientsInput label="\u041a\u043e\u043c\u0443" values={to} onChange={setTo} />
      {!showCc && <button type="button" onClick={() => setShowCc(true)} style={{ border: "none", background: "none", color: "#7c3aed", cursor: "pointer", fontSize: 13, marginBottom: 8 }}>+ CC / BCC</button>}
      {showCc && (<><RecipientsInput label="CC" values={cc} onChange={setCc} /><RecipientsInput label="BCC" values={bcc} onChange={setBcc} /></>)}
      {templates.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <label style={{ fontSize: 13, fontWeight: 600 }}>\u0428\u0430\u0431\u043b\u043e\u043d</label>
          <select value={templateKey} onChange={(e) => applyTemplate(e.target.value)} style={FIELD}><option value="">\u0411\u0435\u0437 \u0448\u0430\u0431\u043b\u043e\u043d\u0430</option>{templates.map((t) => <option key={t.key} value={t.key}>{t.name}</option>)}</select>
        </div>
      )}
      {templateVars.length > 0 && (
        <div style={{ marginBottom: 12, padding: 12, background: "#faf5ff", borderRadius: 8 }}>
          <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 6 }}>\u041f\u0435\u0440\u0435\u043c\u0435\u043d\u043d\u044b\u0435 \u0448\u0430\u0431\u043b\u043e\u043d\u0430</div>
          {templateVars.map((v) => (<div key={v} style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 6 }}><code style={{ minWidth: 120 }}>{"{{" + v + "}}"}</code><input value={variables[v]} onChange={(e) => setVariables((p) => ({ ...p, [v]: e.target.value }))} style={{ ...FIELD, flex: 1 }} /></div>))}
        </div>
      )}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 13, fontWeight: 600 }}>\u0422\u0435\u043c\u0430</label>
        <input value={subject} onChange={(e) => setSubject(e.target.value.slice(0, 255))} style={FIELD} />
        <div style={{ fontSize: 12, color: "#8a8aa0", textAlign: "right" }}>{subject.length} / 255</div>
      </div>
      <div style={{ display: "flex", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
        <div style={{ display: "flex", border: "1px solid #d7d7e0", borderRadius: 8, overflow: "hidden" }}>
          <button type="button" onClick={() => setView("editor")} style={{ padding: "6px 12px", border: "none", cursor: "pointer", background: view === "editor" ? "#7c3aed" : "#fff", color: view === "editor" ? "#fff" : "#1a1a2e" }}>\u0420\u0435\u0434\u0430\u043a\u0442\u043e\u0440</button>
          <button type="button" onClick={() => setView("preview")} style={{ padding: "6px 12px", border: "none", cursor: "pointer", background: view === "preview" ? "#7c3aed" : "#fff", color: view === "preview" ? "#fff" : "#1a1a2e" }}>\u041f\u0440\u0435\u0434\u043f\u0440\u043e\u0441\u043c\u043e\u0442\u0440</button>
        </div>
        <div style={{ display: "flex", border: "1px solid #d7d7e0", borderRadius: 8, overflow: "hidden" }}>
          <button type="button" onClick={() => setFormat("html")} style={{ padding: "6px 12px", border: "none", cursor: "pointer", background: format === "html" ? "#eef2ff" : "#fff" }}>Visual</button>
          <button type="button" onClick={() => setFormat("markdown")} style={{ padding: "6px 12px", border: "none", cursor: "pointer", background: format === "markdown" ? "#eef2ff" : "#fff" }}>Markdown</button>
        </div>
        {view === "preview" && (<div style={{ display: "flex", border: "1px solid #d7d7e0", borderRadius: 8, overflow: "hidden" }}>
          <button type="button" onClick={() => setDevice("desktop")} style={{ padding: "6px 12px", border: "none", cursor: "pointer", background: device === "desktop" ? "#eef2ff" : "#fff" }}>Desktop</button>
          <button type="button" onClick={() => setDevice("mobile")} style={{ padding: "6px 12px", border: "none", cursor: "pointer", background: device === "mobile" ? "#eef2ff" : "#fff" }}>Mobile</button>
        </div>)}
      </div>
      {view === "editor" ? (format === "markdown"
        ? <textarea value={body} onChange={(e) => setBody(e.target.value)} style={{ ...FIELD, minHeight: 260, fontFamily: "monospace", lineHeight: 1.5 }} placeholder="# \u0417\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a..." />
        : <RichTextEditor html={body} onChange={setBody} />
      ) : (<EmailPreview fullHtml={previewHtml} device={device} />)}
      <label style={{ display: "flex", alignItems: "center", gap: 8, margin: "12px 0", fontSize: 14 }}>
        <input type="checkbox" checked={useSignature} onChange={(e) => setUseSignature(e.target.checked)} /> \u0414\u043e\u0431\u0430\u0432\u0438\u0442\u044c \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u044f\u0449\u0438\u043a\u0430
      </label>
      <div style={{ marginBottom: 12 }}>
        <button type="button" onClick={() => imgInput.current?.click()} style={{ padding: "6px 12px", border: "1px solid #d7d7e0", borderRadius: 8, background: "#fff", cursor: "pointer" }}>\u0412\u0441\u0442\u0430\u0432\u0438\u0442\u044c \u0438\u0437\u043e\u0431\u0440\u0430\u0436\u0435\u043d\u0438\u0435 \u0432 \u0442\u0435\u043b\u043e</button>
        <input ref={imgInput} type="file" accept="image/*" multiple hidden onChange={(e) => e.target.files && addFiles(e.target.files, true)} />
        {inlineImages.length > 0 && <span style={{ fontSize: 12, color: "#8a8aa0", marginLeft: 8 }}>{inlineImages.length} \u0438\u0437\u043e\u0431\u0440.</span>}
      </div>
      <div onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(e) => { e.preventDefault(); setDragOver(false); if (e.dataTransfer.files) addFiles(e.dataTransfer.files, false); }}
        style={{ border: `2px dashed ${dragOver ? "#7c3aed" : "#d7d7e0"}`, borderRadius: 8, padding: 16, textAlign: "center", marginBottom: 12, background: dragOver ? "#faf5ff" : "#fafafc" }}>
        <p style={{ margin: 0, color: "#8a8aa0" }}>\u041f\u0435\u0440\u0435\u0442\u0430\u0449\u0438\u0442\u0435 \u0444\u0430\u0439\u043b\u044b \u0441\u044e\u0434\u0430 \u0438\u043b\u0438 <button type="button" onClick={() => fileInput.current?.click()} style={{ border: "none", background: "none", color: "#7c3aed", cursor: "pointer" }}>\u0432\u044b\u0431\u0435\u0440\u0438\u0442\u0435</button></p>
        <input ref={fileInput} type="file" multiple hidden accept={acceptAttribute()} onChange={(e) => e.target.files && addFiles(e.target.files, false)} />
        {attachments.length > 0 && (<div style={{ marginTop: 10, textAlign: "left" }}>
          {attachments.map((a, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "4px 8px", background: "#fff", borderRadius: 6, marginBottom: 4 }}><span>{a.name} <span style={{ color: "#8a8aa0" }}>({formatBytes(a.size)})</span></span><button type="button" onClick={() => setAttachments((p) => p.filter((_, j) => j !== i))} style={{ border: "none", background: "none", color: "#b91c1c", cursor: "pointer" }}>\u0423\u0434\u0430\u043b\u0438\u0442\u044c</button></div>))}
          <div style={{ fontSize: 12, color: "#8a8aa0", marginTop: 4 }}>\u0412\u0441\u0435\u0433\u043e: {formatBytes(totalSize)}</div>
        </div>)}
      </div>
      <button type="button" onClick={() => setConfirming(true)} disabled={sending} style={{ padding: "10px 24px", background: "#7c3aed", color: "#fff", border: "none", borderRadius: 8, cursor: "pointer", fontSize: 15, fontWeight: 600 }}>\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c</button>
      {confirming && (<div style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 50 }}>
        <div style={{ background: "#fff", borderRadius: 12, padding: 24, width: 440, maxWidth: "90%" }}>
          <h3 style={{ marginTop: 0 }}>\u041f\u043e\u0434\u0442\u0432\u0435\u0440\u0436\u0434\u0435\u043d\u0438\u0435 \u043e\u0442\u043f\u0440\u0430\u0432\u043a\u0438</h3>
          <p style={{ fontSize: 14, lineHeight: 1.6 }}>
            <b>\u041e\u0442:</b> {fromName ? `${fromName} <${currentAddress}>` : currentAddress}<br />
            <b>\u041a\u043e\u043c\u0443:</b> {to.join(", ") || "\u2014"}<br />
            {cc.length > 0 && <><b>CC:</b> {cc.join(", ")}<br /></>}
            {bcc.length > 0 && <><b>BCC:</b> {bcc.join(", ")}<br /></>}
            <b>\u0422\u0435\u043c\u0430:</b> {subject || "\u2014"}<br />
            <b>\u0412\u043b\u043e\u0436\u0435\u043d\u0438\u0439:</b> {attachments.length + inlineImages.length}
          </p>
          <div style={{ display: "flex", gap: 8, justifyContent: "flex-end" }}>
            <button type="button" onClick={() => setConfirming(false)} style={{ padding: "8px 16px", border: "1px solid #d7d7e0", borderRadius: 8, background: "#fff", cursor: "pointer" }}>\u041e\u0442\u043c\u0435\u043d\u0430</button>
            <button type="button" onClick={doSend} disabled={sending} style={{ padding: "8px 16px", border: "none", borderRadius: 8, background: "#7c3aed", color: "#fff", cursor: "pointer" }}>{sending ? "\u041e\u0442\u043f\u0440\u0430\u0432\u043a\u0430..." : "\u041e\u0442\u043f\u0440\u0430\u0432\u0438\u0442\u044c"}</button>
          </div>
        </div>
      </div>)}
    </div>
  );
}
export default MailComposer;
