"use client";

import { useSession } from "next-auth/react";
import Spinner from "@/components/ui/Spinner";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import Link from "next/link";

interface Article {
  id: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string;
  published: boolean;
  createdAt: string;
}

export default function AdminContentPage() {
  const { data: session, status } = useSession();
  const router = useRouter();
  const [articles, setArticles] = useState<Article[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editingArticle, setEditingArticle] = useState<Article | null>(null);
  const [form, setForm] = useState({ title: "", content: "", category: "", tags: "", published: false });

  useEffect(() => {
    if (status === "authenticated" && session?.user?.role !== "ADMIN") {
      router.push("/");
    }
  }, [session, status, router]);

  const fetchArticles = async () => {
    const res = await fetch("/api/articles");
    setArticles(await res.json());
  };

  useEffect(() => {
    if (session?.user?.role === "ADMIN") fetchArticles();
  }, [session]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    await fetch("/api/articles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setForm({ title: "", content: "", category: "", tags: "", published: false });
    setShowForm(false);
    fetchArticles();
  };

  const startEdit = (article: Article) => {
    setEditingArticle(article);
    setForm({
      title: article.title,
      content: article.content,
      category: article.category,
      tags: article.tags,
      published: article.published,
    });
    setShowForm(true);
  };

  if (status === "loading") {
    return (
      <div className="min-h-screen flex items-center justify-center bg-neutral-50 dark:bg-dark-900">
        <Spinner />
      </div>
    );
  }

  if (session?.user?.role !== "ADMIN") return null;

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-dark-900 py-8 px-4">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-8">
          <div>
            <Link href="/admin" className="text-cyan-400 hover:text-cyan-300 text-sm mb-2 inline-flex items-center gap-1 transition-colors">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Админ-панель
            </Link>
            <h1 className="text-2xl font-bold text-white">Управление контентом</h1>
          </div>
          <button
            onClick={() => {
              setEditingArticle(null);
              setForm({ title: "", content: "", category: "", tags: "", published: false });
              setShowForm(!showForm);
            }}
            className="btn-primary text-sm"
          >
            {showForm ? "Отмена" : "Создать статью"}
          </button>
        </div>

        {showForm && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="glass-card p-6 mb-8"
          >
            <h3 className="text-lg font-bold text-white mb-4">
              {editingArticle ? "Редактировать статью" : "Новая статья"}
            </h3>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Заголовок</label>
                  <input
                    type="text"
                    value={form.title}
                    onChange={(e) => setForm({ ...form, title: e.target.value })}
                    className="input-field"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Категория</label>
                  <input
                    type="text"
                    value={form.category}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    className="input-field"
                    placeholder="Общее, Книги, Игры, Лор..."
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Содержание (Markdown)</label>
                <textarea
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  className="input-field min-h-[200px] font-mono text-sm"
                  required
                />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Теги (через запятую)</label>
                  <input
                    type="text"
                    value={form.tags}
                    onChange={(e) => setForm({ ...form, tags: e.target.value })}
                    className="input-field"
                    placeholder="tag1, tag2, tag3"
                  />
                </div>
                <div className="flex items-end">
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={form.published}
                      onChange={(e) => setForm({ ...form, published: e.target.checked })}
                      className="w-4 h-4 rounded bg-dark-700 border-white/10"
                    />
                    <span className="text-gray-300">Опубликовать</span>
                  </label>
                </div>
              </div>
              <button type="submit" className="btn-primary">
                {editingArticle ? "Сохранить" : "Создать"}
              </button>
            </form>
          </motion.div>
        )}

        <div className="space-y-3">
          {articles.map((article, i) => (
            <motion.div
              key={article.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              className="glass-card p-4 flex flex-col sm:flex-row items-start sm:items-center gap-4"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="font-medium text-white">{article.title}</span>
                  <span className="px-2 py-0.5 bg-dark-700 text-gray-400 text-xs rounded">{article.category}</span>
                  <span className={`px-2 py-0.5 rounded text-xs ${
                    article.published ? "bg-green-500/20 text-green-400" : "bg-gray-700 text-gray-500"
                  }`}>
                    {article.published ? "Опубликовано" : "Черновик"}
                  </span>
                </div>
                <p className="text-xs text-gray-500 mt-1">
                  {new Date(article.createdAt).toLocaleDateString("ru-RU")} • {article.slug}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => startEdit(article)}
                  className="px-3 py-1 bg-cyan-400/10 text-cyan-400 rounded-lg text-sm hover:bg-cyan-400/20 transition-colors"
                >
                  Редактировать
                </button>
              </div>
            </motion.div>
          ))}
        </div>
      </div>
    </div>
  );
}
