"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useCallback } from "react";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import Spinner from "@/components/ui/Spinner";
import type { AboutBlockRow, BlockType } from "@/lib/aboutBlocks";
import { BLOCK_DEFAULTS, BLOCK_LABELS, BLOCK_TYPES } from "@/lib/aboutBlocks";

// ─── Tiny Toast ──────────────────────────────────────────────────────────────

type ToastType = { msg: string; ok: boolean };

function Toast({ msg, ok }: ToastType) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: 20 }}
      className={`fixed bottom-6 right-6 z-50 rounded-xl px-5 py-3 text-sm font-medium text-white shadow-lg ${
        ok ? "bg-green-600" : "bg-red-500"
      }`}
    >
      {msg}
    </motion.div>
  );
}

// ─── JSON editor modal ───────────────────────────────────────────────────────

interface EditModalProps {
  block: AboutBlockRow;
  onClose: () => void;
  onSave: (id: string, type: BlockType, data: Record<string, unknown>, visible: boolean) => Promise<void>;
}

function EditModal({ block, onClose, onSave }: EditModalProps) {
  const [type, setType] = useState<BlockType>(block.type);
  const [visible, setVisible] = useState(block.visible);
  const [json, setJson] = useState(
    JSON.stringify(block.data as Record<string, unknown>, null, 2),
  );
  const [jsonErr, setJsonErr] = useState("");
  const [saving, setSaving] = useState(false);

  const handleTypeChange = (t: BlockType) => {
    setType(t);
    // Pre-fill with defaults for the new type when user switches
    setJson(JSON.stringify(BLOCK_DEFAULTS[t] as unknown, null, 2));
    setJsonErr("");
  };

  const handleSave = async () => {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(json) as Record<string, unknown>;
    } catch {
      setJsonErr("Неверный JSON");
      return;
    }
    setSaving(true);
    await onSave(block.id, type, parsed, visible);
    setSaving(false);
    onClose();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ background: "rgba(0,0,0,.65)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        exit={{ opacity: 0, scale: 0.95 }}
        className="w-full max-w-2xl rounded-2xl border border-white/10 bg-neutral-900 p-6 shadow-2xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold text-white">Редактировать блок</h3>
          <button onClick={onClose} className="text-neutral-500 hover:text-white transition-colors">
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Type selector */}
        <div className="mb-4">
          <label className="mb-1.5 block text-xs text-neutral-400">Тип блока</label>
          <select
            value={type}
            onChange={(e) => handleTypeChange(e.target.value as BlockType)}
            className="w-full rounded-xl border border-white/10 bg-neutral-800 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>{BLOCK_LABELS[t]}</option>
            ))}
          </select>
        </div>

        {/* Visible toggle */}
        <label className="mb-4 flex cursor-pointer items-center gap-3">
          <div
            onClick={() => setVisible((v) => !v)}
            className={`relative h-6 w-11 rounded-full transition-colors ${
              visible ? "bg-indigo-600" : "bg-neutral-700"
            }`}
          >
            <span
              className={`absolute top-0.5 left-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${
                visible ? "translate-x-5" : ""
              }`}
            />
          </div>
          <span className="text-sm text-neutral-300">Показывать на странице</span>
        </label>

        {/* JSON editor */}
        <div className="mb-1">
          <label className="mb-1.5 block text-xs text-neutral-400">
            Данные блока (JSON)
          </label>
          <textarea
            value={json}
            onChange={(e) => { setJson(e.target.value); setJsonErr(""); }}
            rows={14}
            spellCheck={false}
            className="w-full rounded-xl border border-white/10 bg-neutral-800 px-4 py-3 font-mono text-xs text-white focus:border-indigo-500 focus:outline-none resize-y"
          />
          {jsonErr && <p className="mt-1 text-xs text-red-400">{jsonErr}</p>}
        </div>

        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-white/10 px-5 py-2 text-sm text-neutral-400 hover:text-white transition-colors"
          >
            Отмена
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-indigo-600 px-5 py-2 text-sm font-medium text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </button>
        </div>
      </motion.div>
    </div>
  );
}

// ─── Block card ───────────────────────────────────────────────────────────────

interface BlockCardProps {
  block: AboutBlockRow;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleVisible: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function BlockCard({
  block, isFirst, isLast, onMoveUp, onMoveDown, onToggleVisible, onEdit, onDelete,
}: BlockCardProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -8 }}
      className="flex items-center gap-3 rounded-2xl border border-white/08 bg-neutral-900 p-4"
    >
      {/* Order arrows */}
      <div className="flex flex-col gap-1">
        <button
          onClick={onMoveUp}
          disabled={isFirst}
          className="rounded-lg border border-white/10 p-1 text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
          title="Вверх"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 15l7-7 7 7" />
          </svg>
        </button>
        <button
          onClick={onMoveDown}
          disabled={isLast}
          className="rounded-lg border border-white/10 p-1 text-neutral-500 hover:text-white disabled:opacity-20 transition-colors"
          title="Вниз"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
      </div>

      {/* Label */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span className="text-base">{BLOCK_LABELS[block.type].split(" ")[0]}</span>
          <span className="text-sm font-semibold text-white">{BLOCK_LABELS[block.type].slice(BLOCK_LABELS[block.type].indexOf(" ") + 1)}</span>
        </div>
        <div className="mt-0.5 text-xs text-neutral-600">позиция {block.position}</div>
      </div>

      {/* Visible badge */}
      <span
        className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium ${
          block.visible
            ? "bg-green-500/15 text-green-400"
            : "bg-neutral-700 text-neutral-500"
        }`}
      >
        {block.visible ? "Видим" : "Скрыт"}
      </span>

      {/* Actions */}
      <div className="flex items-center gap-2">
        {/* Toggle visibility */}
        <button
          onClick={onToggleVisible}
          className="rounded-xl border border-white/10 px-3 py-1.5 text-xs text-neutral-400 hover:text-white transition-colors"
          title={block.visible ? "Скрыть" : "Показать"}
        >
          {block.visible ? "Скрыть" : "Показать"}
        </button>
        {/* Edit */}
        <button
          onClick={onEdit}
          className="rounded-xl border border-indigo-500/30 bg-indigo-500/10 px-3 py-1.5 text-xs text-indigo-300 hover:bg-indigo-500/20 transition-colors"
        >
          Изменить
        </button>
        {/* Delete */}
        <button
          onClick={onDelete}
          className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-1.5 text-xs text-red-400 hover:bg-red-500/20 transition-colors"
          title="Удалить блок"
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
          </svg>
        </button>
      </div>
    </motion.div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function AdminAboutBlocksPage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  const [blocks, setBlocks] = useState<AboutBlockRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [editBlock, setEditBlock] = useState<AboutBlockRow | null>(null);
  const [toast, setToast] = useState<ToastType | null>(null);
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<BlockType>("hero");

  const showToast = useCallback((msg: string, ok: boolean) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  // Fetch all blocks (including hidden) for admin
  const fetchBlocks = useCallback(async () => {
    try {
      const res = await fetch("/api/about-blocks?all=1");
      if (!res.ok) throw new Error("Fetch failed");
      const data = (await res.json()) as AboutBlockRow[];
      setBlocks(data.sort((a, b) => a.position - b.position));
    } catch {
      showToast("Не удалось загрузить блоки", false);
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { fetchBlocks(); }, [fetchBlocks]);

  // Toggle visibility
  const toggleVisible = async (block: AboutBlockRow) => {
    try {
      const res = await fetch("/api/about-blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: block.id, visible: !block.visible }),
      });
      if (!res.ok) throw new Error();
      const updated = (await res.json()) as AboutBlockRow;
      setBlocks((prev) => prev.map((b) => (b.id === block.id ? updated : b)));
      showToast(updated.visible ? "Блок показан" : "Блок скрыт", true);
    } catch {
      showToast("Ошибка при обновлении", false);
    }
  };

  // Save block edits
  const saveBlock = async (
    id: string,
    type: BlockType,
    data: Record<string, unknown>,
    visible: boolean,
  ) => {
    try {
      const res = await fetch("/api/about-blocks", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, type, data, visible }),
      });
      if (!res.ok) throw new Error();
      const updated = (await res.json()) as AboutBlockRow;
      setBlocks((prev) => prev.map((b) => (b.id === id ? updated : b)));
      showToast("Сохранено", true);
    } catch {
      showToast("Ошибка при сохранении", false);
    }
  };

  // Delete block
  const deleteBlock = async (block: AboutBlockRow) => {
    if (!confirm(`Удалить блок «${BLOCK_LABELS[block.type]}»?`)) return;
    try {
      const res = await fetch("/api/about-blocks", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: block.id }),
      });
      if (!res.ok) throw new Error();
      setBlocks((prev) => prev.filter((b) => b.id !== block.id));
      showToast("Блок удалён", true);
    } catch {
      showToast("Ошибка при удалении", false);
    }
  };

  // Move block up or down
  const moveBlock = async (idx: number, dir: "up" | "down") => {
    const swapIdx = dir === "up" ? idx - 1 : idx + 1;
    if (swapIdx < 0 || swapIdx >= blocks.length) return;

    const sorted = [...blocks];
    const a = { ...sorted[idx], position: sorted[swapIdx].position };
    const b = { ...sorted[swapIdx], position: sorted[idx].position };
    sorted[idx] = a;
    sorted[swapIdx] = b;
    sorted.sort((x, y) => x.position - y.position);
    setBlocks(sorted);

    try {
      await Promise.all([
        fetch("/api/about-blocks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: a.id, position: a.position }),
        }),
        fetch("/api/about-blocks", {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: b.id, position: b.position }),
        }),
      ]);
    } catch {
      showToast("Ошибка при смене порядка", false);
      fetchBlocks(); // Revert on error
    }
  };

  // Add new block
  const addBlock = async () => {
    setAdding(true);
    try {
      const res = await fetch("/api/about-blocks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          type: newType,
          data: BLOCK_DEFAULTS[newType] as unknown as Record<string, unknown>,
        }),
      });
      if (!res.ok) throw new Error();
      const created = (await res.json()) as AboutBlockRow;
      setBlocks((prev) => [...prev, created].sort((a, b) => a.position - b.position));
      showToast(`Блок «${BLOCK_LABELS[newType]}» добавлен`, true);
    } catch {
      showToast("Не удалось добавить блок", false);
    } finally {
      setAdding(false);
    }
  };

  if (status === "loading" || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-neutral-950">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="min-h-screen bg-neutral-950 px-4 pb-24 pt-8">
      <div className="mx-auto max-w-3xl">
        {/* Header */}
        <div className="mb-8">
          <Link
            href="/admin"
            className="mb-3 inline-flex items-center gap-1 text-sm text-indigo-400 hover:opacity-80 transition-opacity"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Админ-панель
          </Link>
          <div className="flex items-center justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold text-white">Блоки страницы /about</h1>
              <p className="mt-1 text-sm text-neutral-500">
                Управляйте содержимым страницы{" "}
                <Link href="/about" target="_blank" className="text-indigo-400 hover:underline">/about</Link>.
                Изменения отображаются сразу.
              </p>
            </div>
            <Link
              href="/about"
              target="_blank"
              className="shrink-0 flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-neutral-300 hover:bg-white/10 transition-colors"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
              </svg>
              Предпросмотр
            </Link>
          </div>
        </div>

        {/* Block list */}
        <div className="space-y-3">
          <AnimatePresence mode="popLayout">
            {blocks.length === 0 ? (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="rounded-2xl border border-dashed border-white/10 p-10 text-center"
              >
                <p className="text-neutral-500">Блоков пока нет. Добавьте первый блок ниже.</p>
              </motion.div>
            ) : (
              blocks.map((block, idx) => (
                <BlockCard
                  key={block.id}
                  block={block}
                  isFirst={idx === 0}
                  isLast={idx === blocks.length - 1}
                  onMoveUp={() => moveBlock(idx, "up")}
                  onMoveDown={() => moveBlock(idx, "down")}
                  onToggleVisible={() => toggleVisible(block)}
                  onEdit={() => setEditBlock(block)}
                  onDelete={() => deleteBlock(block)}
                />
              ))
            )}
          </AnimatePresence>
        </div>

        {/* Add block */}
        <div className="mt-6 flex items-center gap-3">
          <select
            value={newType}
            onChange={(e) => setNewType(e.target.value as BlockType)}
            className="flex-1 rounded-xl border border-white/10 bg-neutral-900 px-4 py-2.5 text-sm text-white focus:border-indigo-500 focus:outline-none"
          >
            {BLOCK_TYPES.map((t) => (
              <option key={t} value={t}>{BLOCK_LABELS[t]}</option>
            ))}
          </select>
          <button
            onClick={addBlock}
            disabled={adding}
            className="flex items-center gap-2 rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-indigo-500 disabled:opacity-50 transition-colors"
          >
            {adding ? (
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
            ) : (
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
              </svg>
            )}
            Добавить блок
          </button>
        </div>

        <p className="mt-4 text-xs text-neutral-700">
          Всего блоков: {blocks.length} · Видимых: {blocks.filter((b) => b.visible).length}
        </p>
      </div>

      {/* Edit modal */}
      <AnimatePresence>
        {editBlock && (
          <EditModal
            key={editBlock.id}
            block={editBlock}
            onClose={() => setEditBlock(null)}
            onSave={saveBlock}
          />
        )}
      </AnimatePresence>

      {/* Toast */}
      <AnimatePresence>{toast && <Toast {...toast} />}</AnimatePresence>
    </div>
  );
}
