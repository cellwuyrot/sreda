"use client";
import React, { useEffect, useState } from "react";
import MailComposer from "./MailComposer";

interface Mailbox { address: string; localPart: string; label: string; purpose?: string; }
interface Template { key: string; name: string; subject: string; format: string; body: string; }

export function MailComposerPage() {
  const [mailboxes, setMailboxes] = useState<Mailbox[]>([]);
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    Promise.all([
      fetch("/api/admin/mail/mailboxes").then((r) => r.json() as Promise<{ mailboxes?: Mailbox[] }>),
      fetch("/api/admin/mail/templates").then((r) => r.json() as Promise<{ templates?: Template[] }>),
    ])
      .then(([m, t]) => {
        setMailboxes(m.mailboxes || []);
        setTemplates(t.templates || []);
      })
      .catch(() => setError("Не удалось загрузить данные"))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div style={{ padding: 24 }}>Загрузка…</div>;
  if (error) return <div style={{ padding: 24, color: "#b91c1c" }}>{error}</div>;
  if (!mailboxes.length) return <div style={{ padding: 24 }}>Нет доступных почтовых ящиков.</div>;
  return <MailComposer mailboxes={mailboxes} templates={templates} />;
}

export default MailComposerPage;
