"use client";

import { useState, useEffect } from "react";
import Spinner from "@/components/ui/Spinner";
import { motion } from "framer-motion";
import Link from "next/link";
import EditableText from "@/components/EditableText";
import { stripMarkdown } from "@/components/ui/MarkdownRenderer";

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

export default function LibraryPage() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<Article[] | null>(null);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    fetch("/api/articles?published=true").then((r) => r.json()).then(setArticles);
  }, []);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 2) {
      setSearchResults(null);
      return;
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(searchQuery)}&type=articles`);
        if (res.ok) {
          const data = await res.json();
          setSearchResults(data.articles || []);
        }
      } catch {
        setSearchResults(null);
      }
      setSearching(false);
    }, 300);
    return () => clearTimeout(timer);
  }, [searchQuery]);

  const categories = Array.from(new Set(articles.map((a) => a.category)));
  const displayArticles = searchResults ?? (selectedCategory
    ? articles.filter((a) => a.category === selectedCategory)
    : articles);

  return (
    <div className="min-h-screen bg-dark-900 py-12 px-4 max-md:px-0 max-md:py-6">
      <div className="fixed inset-0 pointer-events-none">
        <div className="absolute top-0 right-0 w-[500px] h-[500px] bg-fantasy-emerald/5 rounded-full blur-[150px]" />
      </div>

      <div className="max-w-5xl mx-auto relative">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center mb-12"
        >
          <h1 className="section-title text-4xl md:text-5xl mb-4">TZ.Library</h1>
          <EditableText contentKey="library.subtitle" defaultValue="Хранилище знаний и лора вселенной T.Р.И.О.Z. Статьи, история, мифология." tag="p" className="text-gray-400 max-w-xl mx-auto" />
        </motion.div>

        {/* Search */}
        <div className="max-w-lg mx-auto mb-8">
          <div className="relative">
            <svg className="absolute left-4 top-1/2 -translate-y-1/2 w-5 h-5 text-gray-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Поиск по статьям..."
              className="w-full bg-dark-700/50 border border-white/10 rounded-xl pl-12 pr-4 py-3 text-sm text-white placeholder:text-gray-500 focus:outline-none focus:border-cyan-400/50 transition-colors"
            />
            {searching && (
              <div className="absolute right-4 top-1/2 -translate-y-1/2">
                <Spinner size="sm" />
              </div>
            )}
          </div>
          {searchResults !== null && (
            <p className="text-xs text-gray-500 mt-2 text-center">
              {searchResults.length === 0 ? "Ничего не найдено" : `Найдено: ${searchResults.length}`}
            </p>
          )}
        </div>

        {categories.length > 0 && !searchResults && (
          <div className="flex flex-wrap gap-2 justify-center mb-8">
            <button
              onClick={() => setSelectedCategory(null)}
              className={`px-4 py-2 rounded-xl text-sm transition-all duration-300 ${
                !selectedCategory
                  ? "bg-cyan-400/20 text-cyan-400 border border-cyan-400/30"
                  : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
              }`}
            >
              Все
            </button>
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setSelectedCategory(cat)}
                className={`px-4 py-2 rounded-xl text-sm transition-all duration-300 ${
                  selectedCategory === cat
                    ? "bg-cyan-400/20 text-cyan-400 border border-cyan-400/30"
                    : "text-gray-400 hover:text-white hover:bg-white/5 border border-transparent"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        )}

        <div className="space-y-4">
          {displayArticles.map((article, i) => (
            <motion.div
              key={article.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.1 }}
            >
              <Link href={`/library/${article.slug}`}>
                <div className="glass-card-hover p-6 max-md:p-4 max-md:rounded-none max-md:border-x-0 group">
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <span className="px-2 py-0.5 bg-fantasy-emerald/20 text-fantasy-emerald text-xs rounded-lg">
                          {article.category}
                        </span>
                        <span className="text-xs text-gray-600">
                          {new Date(article.createdAt).toLocaleDateString("ru-RU")}
                        </span>
                      </div>
                      <h3 className="text-lg font-bold text-white group-hover:text-cyan-400 transition-colors">
                        {article.title}
                      </h3>
                      <p className="text-gray-400 text-sm mt-2 line-clamp-2">
                        {stripMarkdown(article.content).slice(0, 200)}...
                      </p>
                      {article.tags && (
                        <div className="flex gap-1 mt-3">
                          {article.tags.split(",").map((tag) => (
                            <span key={tag} className="text-xs text-gray-500 bg-dark-700 px-2 py-0.5 rounded">
                              #{tag.trim()}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <svg className="w-5 h-5 text-gray-600 group-hover:text-cyan-400 transition-all transform group-hover:translate-x-1 flex-shrink-0 mt-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}

          {displayArticles.length === 0 && !searchResults && (
            <div className="text-center py-20 text-gray-500">
              <span className="text-4xl block mb-3">📚</span>
              <p>Статьи скоро появятся</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
