"use client";

import { useState, useEffect } from "react";
import Spinner from "@/components/ui/Spinner";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import Link from "next/link";
import MarkdownRenderer from "@/components/ui/MarkdownRenderer";

interface Article {
  id: string;
  title: string;
  slug: string;
  content: string;
  category: string;
  tags: string;
  createdAt: string;
  updatedAt: string;
}

export default function ArticlePage() {
  const params = useParams();
  const [article, setArticle] = useState<Article | null>(null);

  useEffect(() => {
    fetch("/api/articles?published=true")
      .then((r) => r.json())
      .then((articles: Article[]) => {
        const found = articles.find((a) => a.slug === params.slug);
        setArticle(found || null);
      });
  }, [params.slug]);

  if (!article) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-dark-900">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-dark-900 py-12 px-4 max-md:px-3 max-md:py-4">
      <div className="max-w-3xl mx-auto">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
          <Link href="/library" className="inline-flex items-center gap-2 text-cyan-400 hover:text-cyan-300 mb-8 text-sm transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
            Назад к библиотеке
          </Link>

          <div className="flex items-center gap-3 mb-6">
            <span className="px-3 py-1 bg-fantasy-emerald/20 text-fantasy-emerald text-sm rounded-lg">
              {article.category}
            </span>
            <span className="text-sm text-gray-500">
              {new Date(article.createdAt).toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" })}
            </span>
          </div>

          <Card className="p-8 md:p-12 max-md:p-4 max-md:text-base">
            <MarkdownRenderer content={article.content} />
          </Card>

          {article.tags && (
            <div className="flex gap-2 mt-6">
              {article.tags.split(",").map((tag) => (
                <Badge key={tag} tone="neutral">
                  #{tag.trim()}
                </Badge>
              ))}
            </div>
          )}
        </motion.div>
      </div>
    </div>
  );
}
