"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

import { useAdminBackHref } from "@/components/admin/useAdminBackHref"; // FIX-EDR2
export default function AdminAiPage() {
  // FIX-EDR2: редактору «Назад» ведёт в «Редакторскую», админу — в админку
  const backHref = useAdminBackHref();
  const { data: session, status } = useSession();
  const router = useRouter();
  const [settings, setSettings] = useState({
    ai_provider: "openai",
    ai_api_key: "",
    ai_model: "",
    ai_system_prompt: "",
  });
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") {
      router.push("/");
    }
  }, [session, status, router]);

  useEffect(() => {
    if ((session?.user?.role === "ADMIN" || session?.user?.role === "EDITOR")) {
      fetch("/api/ai/settings")
        .then((r) => r.json())
        .then((data) => {
          setSettings((prev) => ({ ...prev, ...data }));
        });
    }
  }, [session]);

  const save = async () => {
    setSaving(true);
    await fetch("/api/ai/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(settings),
    });
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN" && session?.user?.role !== "EDITOR") return null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-3xl mx-auto">
        <div className="mb-8">
          <Link href={backHref} className="text-violet-500 hover:text-violet-400 text-sm mb-2 inline-flex items-center gap-1 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Админ-панель
          </Link>
          <h1 className="text-2xl font-bold text-neutral-900 dark:text-white">Настройки ИИ-ассистента</h1>
          <p className="text-neutral-500 text-sm mt-1">Подключение нейросети для пользователей</p>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-white dark:bg-neutral-800/50 rounded-2xl border border-neutral-200 dark:border-white/10 p-6 space-y-6"
        >
          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Провайдер</label>
            <div className="grid grid-cols-2 gap-3">
              {[
                { id: "openai", label: "OpenAI (GPT)", desc: "GPT-4o, GPT-4o-mini" },
                { id: "anthropic", label: "Anthropic (Claude)", desc: "Claude Sonnet, Opus" },
              ].map((p) => (
                <button
                  key={p.id}
                  onClick={() => setSettings((s) => ({ ...s, ai_provider: p.id }))}
                  className={`p-4 rounded-xl border text-left transition-all ${
                    settings.ai_provider === p.id
                      ? "border-violet-500 bg-violet-50 dark:bg-violet-500/10"
                      : "border-neutral-200 dark:border-white/10 hover:border-neutral-300 dark:hover:border-white/20"
                  }`}
                >
                  <p className={`font-medium text-sm ${settings.ai_provider === p.id ? "text-violet-600 dark:text-violet-400" : "text-neutral-700 dark:text-neutral-300"}`}>
                    {p.label}
                  </p>
                  <p className="text-xs text-neutral-400 mt-0.5">{p.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">API Ключ</label>
            <input
              type="password"
              value={settings.ai_api_key}
              onChange={(e) => setSettings((s) => ({ ...s, ai_api_key: e.target.value }))}
              placeholder={settings.ai_provider === "openai" ? "sk-..." : "sk-ant-..."}
              className="w-full px-4 py-3 rounded-xl text-sm bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Модель</label>
            <input
              type="text"
              value={settings.ai_model}
              onChange={(e) => setSettings((s) => ({ ...s, ai_model: e.target.value }))}
              placeholder={settings.ai_provider === "openai" ? "gpt-4o-mini" : "claude-sonnet-4-20250514"}
              className="w-full px-4 py-3 rounded-xl text-sm bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30"
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-neutral-700 dark:text-neutral-300 mb-2">Системный промт</label>
            <textarea
              value={settings.ai_system_prompt}
              onChange={(e) => setSettings((s) => ({ ...s, ai_system_prompt: e.target.value }))}
              placeholder="Ты — ИИ-ассистент экосистемы TrioZ. Отвечай на русском языке."
              rows={4}
              className="w-full px-4 py-3 rounded-xl text-sm bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30 resize-none"
            />
          </div>

          <Button onClick={save} disabled={saving} size="lg" fullWidth>
            {saving ? "Сохранение..." : saved ? "Сохранено ✓" : "Сохранить настройки"}
          </Button>
        </motion.div>
      </div>
    </div>
  );
}
