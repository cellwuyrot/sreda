"use client";

import { useSession } from "next-auth/react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import Button from "@/components/ui/Button";
import InfoTooltip from "@/components/ui/InfoTooltip";
import { motion } from "framer-motion";
import Link from "next/link";

export default function AdminWelcomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    fetch("/api/welcome")
      .then((r) => r.json())
      .then((data) => {
        setText(data.text || "");
        setLoading(false);
      });
  }, []);

  const handleSave = async () => {
    setSaving(true);
    setSaved(false);
    await fetch("/api/welcome", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 3000);
  };

  if (status === "loading" || loading) {
    return <div className="min-h-screen flex items-center justify-center text-white">Загрузка...</div>;
  }

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <div className="flex items-center gap-3 mb-6">
            <Link href="/admin" className="text-gray-400 hover:text-white transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
            </Link>
            <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">
              Приветственная форма{" "}
              <InfoTooltip
                side="bottom"
                text="Этот текст видит каждый новый пользователь сразу после регистрации. В нём же лежит правовая часть — про обработку персональных данных."
              />
            </h1>
          </div>

          <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6">
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              rows={12}
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-white/10 rounded-xl p-4 text-sm text-neutral-900 dark:text-white resize-y focus:outline-none focus:ring-2 focus:ring-violet-500/50"
              placeholder="Введите текст приветственной формы..."
            />

            <div className="flex items-center gap-3 mt-4">
              <Button onClick={handleSave} disabled={saving} size="lg">
                {saving ? "Сохранение..." : "Сохранить"}
              </Button>
              {saved && <span className="text-sm text-green-500">Сохранено</span>}
            </div>
          </div>

          <div className="mt-6 bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-white/10 rounded-2xl p-6">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white mb-3">Предпросмотр</h3>
            <div className="bg-neutral-50 dark:bg-neutral-800 rounded-xl p-4 text-sm text-neutral-600 dark:text-neutral-300 whitespace-pre-wrap leading-relaxed">
              {text || "Текст не задан"}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
