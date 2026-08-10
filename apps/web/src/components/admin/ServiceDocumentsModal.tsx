"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_SIZE,
  formatSize,
  type ServiceDocument,
} from "@/lib/businessPayment";

/**
 * BUSINESS-PAY: документы услуги («Сервисы и система» → кнопка рядом с услугой).
 *
 * Здесь хранятся шаблоны договоров и приложений, привязанные к услуге. Клиент
 * видит их не отсюда напрямую: при выставлении счёта список копируется в сам
 * счёт. Именно поэтому удаление документа здесь безопасно: уже выставленные счета
 * оно не трогает — меняется только то, что попадёт в следующие.
 */

interface Props {
  serviceId: string;
  serviceTitle: string;
  onClose: () => void;
}

export default function ServiceDocumentsModal({ serviceId, serviceTitle, onClose }: Props) {
  const [documents, setDocuments] = useState<ServiceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/services/${serviceId}/documents`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить документы");
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, [serviceId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function upload(file: File) {
    if (documents.length >= MAX_DOCUMENTS) {
      setError(`Не более ${MAX_DOCUMENTS} документов на услугу`);
      return;
    }
    if (file.size > MAX_DOCUMENT_SIZE) {
      setError(`Файл слишком большой (макс. ${formatSize(MAX_DOCUMENT_SIZE)})`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/upload/document", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData?.error || "Не удалось загрузить файл");

      const res = await fetch(`/api/services/${serviceId}/documents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось сохранить документ");
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(docId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/services/${serviceId}/documents?docId=${docId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось убрать документ");
      setDocuments(data.documents ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-white/10 bg-neutral-900 p-5"
      >
        <div className="flex items-start gap-3 mb-1">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-white">Документы услуги</h3>
            <p className="text-xs text-gray-400 truncate">{serviceTitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-9 h-9 rounded-lg bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white"
          >
            ✕
          </button>
        </div>

        <p className="text-xs text-gray-500 mb-4">
          Эти файлы подставляются в форму оплаты при выборе этой услуги. Клиент видит их
          в своём деловом чате и обязан ознакомиться с ними до подписи и оплаты.
        </p>

        {loading ? (
          <div className="py-10 flex justify-center"><Spinner /></div>
        ) : (
          <div className="space-y-2">
            {documents.length === 0 && (
              <p className="text-sm text-gray-500 py-4 text-center">Документов пока нет</p>
            )}
            {documents.map((d) => (
              <div
                key={d.id}
                className="flex items-center gap-3 p-2.5 rounded-xl bg-white/5 border border-white/10"
              >
                <a
                  href={d.url}
                  target="_blank"
                  rel="noreferrer"
                  className="min-w-0 flex-1 hover:underline"
                >
                  <span className="block text-sm text-white truncate">{d.name}</span>
                  <span className="block text-[11px] text-gray-500">{formatSize(d.size)}</span>
                </a>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => remove(d.id)}
                  title="Убрать"
                  aria-label={`Убрать ${d.name}`}
                  className="w-8 h-8 rounded-lg bg-white/5 hover:bg-red-500/20 text-gray-400 hover:text-red-300 flex-shrink-0 disabled:opacity-40"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>
        )}

        <button
          type="button"
          disabled={busy || documents.length >= MAX_DOCUMENTS}
          onClick={() => fileRef.current?.click()}
          className="mt-4 w-full py-2.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-black text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {busy ? "Загрузка…" : "Добавить документ"}
        </button>
        <input
          ref={fileRef}
          type="file"
          hidden
          accept=".pdf,.doc,.docx,.rtf,.txt,.jpg,.jpeg,.png,.webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void upload(f);
          }}
        />

        {error && <p className="mt-3 text-xs text-red-400">{error}</p>}
      </motion.div>
    </motion.div>
  );
}
