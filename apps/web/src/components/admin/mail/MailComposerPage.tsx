"use client";
import React, { useEffect, useState } from "react";
import MailComposer from "./MailComposer";

export function MailComposerPage() {
  const [mailboxes, setMailboxes] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  useEffect(() => {
    Promise.all([
      fetch("/api/admin/mail/mailboxes").then((r) => r.json()),
      fetch("/api/admin/mail/templates").then((r) => r.json()),
    ]).then(([m, t]) => { setMailboxes(m?.mailboxes || []); setTemplates(t?.templates || []); })
      .catch(() => setError("\u041d\u0435 \u0443\u0434\u0430\u043b\u043e\u0441\u044c \u0437\u0430\u0433\u0440\u0443\u0437\u0438\u0442\u044c \u0434\u0430\u043d\u043d\u044b\u0435")).finally(() => setLoading(false));
  }, []);
  if (loading) return <div style={{ padding: 24 }}>\u0417\u0430\u0433\u0440\u0443\u0437\u043a\u0430\u2026</div>;
  if (error) return <div style={{ padding: 24, color: "#b91c1c" }}>{error}</div>;
  if (!mailboxes.length) return <div style={{ padding: 24 }}>\u041d\u0435\u0442 \u0434\u043e\u0441\u0442\u0443\u043f\u043d\u044b\u0445 \u043f\u043e\u0447\u0442\u043e\u0432\u044b\u0445 \u044f\u0449\u0438\u043a\u043e\u0432.</div>;
  return <MailComposer mailboxes={mailboxes} templates={templates} />;
}
export default MailComposerPage;
