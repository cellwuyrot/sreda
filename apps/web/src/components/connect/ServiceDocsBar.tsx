"use client";

import { useEffect, useState } from "react";

/**
 * FIX-SRVDOC: документы услуги внутри её раздела.
 *
 * Каналы услуги (новости, обсуждение, вопросы) знают свой serviceId — только по нему
 * и понятно, по какой бумаге идёт работа. Запрос идёт один раз на открытие
 * раздела; пустой список и отказ ничего не рисуют: полоса «документов нет» в
 * шапке каждого чата только мешает.
 */

interface ServiceDoc {
  id: string;
  name: string;
  url: string;
  size: number;
}

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

export default function ServiceDocsBar({ serviceId }: { serviceId?: string | null }) {
  const [docs, setDocs] = useState<ServiceDoc[]>([]);
  const [title, setTitle] = useState("");
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!serviceId) {
      setDocs([]);
      return;
    }
    let alive = true;
    fetch(`/api/services/${serviceId}/documents`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        setDocs(Array.isArray(d.documents) ? d.documents : []);
        setTitle(typeof d.title === "string" ? d.title : "");
      })
      .catch(() => {
        if (alive) setDocs([]);
      });
    return () => {
      alive = false;
    };
  }, [serviceId]);

  if (!serviceId || docs.length === 0) return null;

  return (
    <div className="flex-shrink-0 border-b border-[var(--cn-border)] bg-violet-50/60 px-4 py-2 dark:bg-cyan-500/5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2 text-left text-xs font-medium text-violet-700 dark:text-cyan-300"
        aria-expanded={open}
      >
        <svg className="h-4 w-4 flex-shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <path d="M14 2v6h6" />
        </svg>
        <span className="truncate">
          {title ? `Документы по услуге «${title}»` : "Документы по услуге"}
        </span>
        <span className="ml-1 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] dark:bg-cyan-500/15">{docs.length}</span>
        <span className="ml-auto text-[10px] text-neutral-400">{open ? "Скрыть" : "Показать"}</span>
      </button>

      {open && (
        <ul className="mt-2 space-y-1">
          {docs.map((doc) => (
            <li key={doc.id}>
              <a
                href={doc.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs text-neutral-700 transition hover:bg-white dark:text-gray-200 dark:hover:bg-white/5"
              >
                <span className="truncate">{doc.name}</span>
                {doc.size > 0 && <span className="ml-auto flex-shrink-0 text-[10px] text-neutral-400">{formatSize(doc.size)}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
