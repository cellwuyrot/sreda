"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";

const components: Components = {
  h1: ({ children }) => <h1 className="text-3xl font-bold text-white mb-4 mt-8">{children}</h1>,
  h2: ({ children }) => <h2 className="text-2xl font-bold text-white mb-3 mt-6">{children}</h2>,
  h3: ({ children }) => <h3 className="text-xl font-bold text-white mb-2 mt-4">{children}</h3>,
  h4: ({ children }) => <h4 className="text-lg font-semibold text-white mb-2 mt-3">{children}</h4>,
  p: ({ children }) => <p className="text-gray-300 leading-relaxed mb-3">{children}</p>,
  strong: ({ children }) => <strong className="text-white font-semibold">{children}</strong>,
  em: ({ children }) => <em className="text-gray-400 italic">{children}</em>,
  ul: ({ children }) => <ul className="list-disc list-inside text-gray-300 space-y-1 mb-4 ml-4">{children}</ul>,
  ol: ({ children }) => <ol className="list-decimal list-inside text-gray-300 space-y-1 mb-4 ml-4">{children}</ol>,
  li: ({ children }) => <li className="text-gray-300">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="border-l-4 border-cyan-400/40 pl-4 my-4 text-gray-400 italic">{children}</blockquote>
  ),
  code: ({ children, className }) => {
    const isBlock = className?.includes("language-");
    if (isBlock) {
      return (
        <pre className="bg-dark-700 rounded-xl p-4 overflow-x-auto my-4">
          <code className="text-sm text-gray-300 font-mono">{children}</code>
        </pre>
      );
    }
    return <code className="bg-dark-700 text-cyan-400 px-1.5 py-0.5 rounded text-sm font-mono">{children}</code>;
  },
  a: ({ href, children }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2 transition-colors">
      {children}
    </a>
  ),
  hr: () => <hr className="border-white/10 my-6" />,
  table: ({ children }) => (
    <div className="overflow-x-auto my-4">
      <table className="w-full text-sm text-gray-300 border-collapse">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="bg-dark-700 text-white">{children}</thead>,
  th: ({ children }) => <th className="px-4 py-2 text-left border border-white/10 font-semibold">{children}</th>,
  td: ({ children }) => <td className="px-4 py-2 border border-white/10">{children}</td>,
  img: ({ src, alt }) => (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt || ""} className="rounded-xl max-w-full my-4" loading="lazy" />
  ),
};

interface MarkdownRendererProps {
  content: string;
  className?: string;
}

export default function MarkdownRenderer({ content, className }: MarkdownRendererProps) {
  return (
    <div className={className}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {content}
      </ReactMarkdown>
    </div>
  );
}

export function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s/g, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/__(.+?)__/g, "$1")
    .replace(/_(.+?)_/g, "$1")
    .replace(/\[(.+?)\]\(.+?\)/g, "$1")
    .replace(/!\[.*?\]\(.+?\)/g, "")
    .replace(/`{1,3}[^`]*`{1,3}/g, "")
    .replace(/^\s*[-*+]\s/gm, "")
    .replace(/^\s*\d+\.\s/gm, "")
    .replace(/^\s*>/gm, "")
    .replace(/\n{2,}/g, " ")
    .replace(/\n/g, " ")
    .trim();
}
