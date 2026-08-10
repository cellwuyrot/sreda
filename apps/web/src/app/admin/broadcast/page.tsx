"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState, useRef } from "react";
import { motion } from "framer-motion";
import Image from "next/image";
import Link from "next/link";

import { useAdminBackHref, useAdminBackLabel } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
export default function BroadcastPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const backLabel = useAdminBackLabel();
  const { data: session, status } = useSession();
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [uploading, setUploading] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<{ sent: number; total: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") {
      router.push("/");
    }
  }, [session, status, router]);

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    const fd = new FormData();
    fd.append("file", file);
    fd.append("dir", "broadcast");

    try {
      const res = await fetch("/api/admin/upload", { method: "POST", body: fd });
      const data = await res.json();
      if (res.ok) {
        setImageUrl(data.url);
      } else {
        setError(data.error || "Ошибка загрузки");
      }
    } catch {
      setError("Ошибка загрузки изображения");
    } finally {
      setUploading(false);
    }
  };

  const handleSend = async () => {
    if (!title.trim() || !body.trim()) {
      setError("Заполните тему и сообщение");
      return;
    }

    setSending(true);
    setError("");
    setResult(null);

    try {
      const res = await fetch("/api/admin/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), body: body.trim(), imageUrl }),
      });
      const data = await res.json();
      if (res.ok) {
        setResult(data);
        setTitle("");
        setBody("");
        setImageUrl("");
      } else {
        setError(data.error || "Ошибка отправки");
      }
    } catch {
      setError("Ошибка отправки рассылки");
    } finally {
      setSending(false);
    }
  };

  if (status === "loading") return null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-2xl mx-auto">
        <Link href={backHref} className="text-sm text-gray-400 hover:text-white mb-4 inline-block">
          {backLabel}
        </Link>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white mb-6">Рассылка уведомлений</h1>

          <div className="glass-card p-6 space-y-5">
            {/* Title */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-gray-300 mb-1.5">
                Тема
              </label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="Заголовок уведомления"
                className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-gray-500 focus:outline-none focus:border-violet-400 dark:focus:border-cyan-400"
              />
            </div>

            {/* Body */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-gray-300 mb-1.5">
                Сообщение
              </label>
              <textarea
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Текст уведомления..."
                rows={6}
                className="w-full px-4 py-2.5 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-neutral-900 dark:text-white placeholder-neutral-400 dark:placeholder-gray-500 focus:outline-none focus:border-violet-400 dark:focus:border-cyan-400 resize-none"
              />
            </div>

            {/* Image */}
            <div>
              <label className="block text-sm font-medium text-neutral-700 dark:text-gray-300 mb-1.5">
                Изображение (необязательно)
              </label>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                onChange={handleUpload}
                className="hidden"
              />
              <div className="flex items-center gap-3">
                <button
                  onClick={() => fileRef.current?.click()}
                  disabled={uploading}
                  className="px-4 py-2 bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 rounded-xl text-sm text-neutral-700 dark:text-gray-300 hover:bg-neutral-200 dark:hover:bg-white/10 transition-colors disabled:opacity-50"
                >
                  {uploading ? "Загрузка..." : "Загрузить изображение"}
                </button>
                {imageUrl && (
                  <button
                    onClick={() => setImageUrl("")}
                    className="text-sm text-red-500 hover:text-red-400"
                  >
                    Удалить
                  </button>
                )}
              </div>
              {imageUrl && (
                <div className="mt-3 relative rounded-xl overflow-hidden border border-neutral-200 dark:border-white/10" style={{ maxHeight: 200 }}>
                  <Image src={imageUrl} alt="Превью" width={600} height={200} className="w-full h-auto object-cover" />
                </div>
              )}
            </div>

            {/* Preview */}
            <div className="border-t border-neutral-200 dark:border-white/10 pt-4">
              <p className="text-xs text-neutral-500 dark:text-gray-500 mb-2 uppercase tracking-wider">Предпросмотр</p>
              <div className="p-4 rounded-xl bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10">
                <p className="font-semibold text-neutral-900 dark:text-white text-sm">{title || "Тема не указана"}</p>
                <p className="text-neutral-600 dark:text-gray-400 text-sm mt-1 whitespace-pre-wrap">{body || "Текст сообщения..."}</p>
                {imageUrl && (
                  <div className="mt-2 rounded-lg overflow-hidden">
                    <Image src={imageUrl} alt="" width={400} height={150} className="w-full h-auto object-cover" />
                  </div>
                )}
              </div>
            </div>

            {error && (
              <p className="text-red-500 text-sm">{error}</p>
            )}

            {result && (
              <p className="text-green-500 text-sm">
                Отправлено {result.sent} из {result.total} пользователям
              </p>
            )}

            {/* Send */}
            <button
              onClick={handleSend}
              disabled={sending || !title.trim() || !body.trim()}
              className="w-full py-3 bg-violet-600 dark:bg-cyan-500 text-white font-medium rounded-xl hover:bg-violet-700 dark:hover:bg-cyan-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {sending ? "Отправка..." : "Отправить всем пользователям"}
            </button>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
