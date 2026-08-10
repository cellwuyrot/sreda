"use client";

import { createContext, useContext, useState, useCallback, useEffect, useRef, ReactNode } from "react";
import { useSession } from "next-auth/react";
import { usePathname } from "next/navigation";

interface InlineEditContextType {
  editMode: boolean;
  toggleEditMode: () => void;
  isAdmin: boolean;
  saveContent: (key: string, value: string) => Promise<void>;
  getContent: (key: string) => string | undefined;
  contents: Record<string, string>;
}

const InlineEditContext = createContext<InlineEditContextType>({
  editMode: false,
  toggleEditMode: () => {},
  isAdmin: false,
  saveContent: async () => {},
  getContent: () => undefined,
  contents: {},
});

export function useInlineEdit() {
  return useContext(InlineEditContext);
}

function getElementPath(el: HTMLElement): string {
  const parts: string[] = [];
  let cur: HTMLElement | null = el;
  while (cur && cur !== document.body) {
    const tag = cur.tagName.toLowerCase();
    const par: HTMLElement | null = cur.parentElement;
    if (par) {
      const curTag = cur.tagName;
      const siblings = Array.from(par.children).filter(
        (c) => c.tagName === curTag
      );
      const idx = siblings.indexOf(cur);
      parts.unshift(siblings.length > 1 ? `${tag}[${idx}]` : tag);
    } else {
      parts.unshift(tag);
    }
    cur = par;
  }
  return parts.join(">");
}

function isTextElement(el: HTMLElement): boolean {
  const tag = el.tagName.toLowerCase();
  const textTags = [
    "h1", "h2", "h3", "h4", "h5", "h6",
    "p", "span", "a", "li", "label", "button",
    "td", "th", "dt", "dd", "figcaption", "blockquote",
  ];
  if (!textTags.includes(tag)) return false;

  const hasDirectText = Array.from(el.childNodes).some(
    (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
  );
  if (!hasDirectText) return false;
  if (el.closest("[data-no-edit]")) return false;
  if (el.closest("input, textarea, select, [contenteditable=true]")) return false;

  // Skip compound elements (have child elements with text — editing them causes duplication)
  const hasChildElementsWithText = Array.from(el.children).some(
    child => child.textContent?.trim()
  );
  if (hasChildElementsWithText) return false;

  const text = el.textContent?.trim() || "";
  if (text.length < 1 || text.length > 2000) return false;

  return true;
}

function ContentApplier({ contents }: { contents: Record<string, string> }) {
  const pathname = usePathname();
  const appliedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!contents || Object.keys(contents).length === 0) return;

    const applyOverrides = () => {
      const walker = document.createTreeWalker(
        document.body,
        NodeFilter.SHOW_ELEMENT,
        {
          acceptNode: (node) => {
            const el = node as HTMLElement;
            if (isTextElement(el)) return NodeFilter.FILTER_ACCEPT;
            return NodeFilter.FILTER_SKIP;
          },
        }
      );

      let node: Node | null;
      while ((node = walker.nextNode())) {
        const el = node as HTMLElement;
        const path = getElementPath(el);
        const saved = contents[path];
        if (saved && !appliedRef.current.has(path)) {
          const textNode = Array.from(el.childNodes).find(
            (n) => n.nodeType === Node.TEXT_NODE && n.textContent?.trim()
          );
          if (textNode) {
            if (!el.getAttribute("data-original")) {
              el.setAttribute("data-original", textNode.textContent?.trim() || "");
            }
            textNode.textContent = saved;
            appliedRef.current.add(path);
          }
        }
      }
    };

    const timer = setTimeout(applyOverrides, 300);
    const timer2 = setTimeout(applyOverrides, 1000);
    const timer3 = setTimeout(applyOverrides, 2500);

    return () => {
      clearTimeout(timer);
      clearTimeout(timer2);
      clearTimeout(timer3);
    };
  }, [contents, pathname]);

  useEffect(() => {
    appliedRef.current.clear();
  }, [pathname]);

  return null;
}

export function InlineEditProvider({ children }: { children: ReactNode }) {
  const { data: session } = useSession();
  const [editMode, setEditMode] = useState(false);
  const [contents, setContents] = useState<Record<string, string>>({});

  const isAdmin = session?.user?.role === "ADMIN";

  useEffect(() => {
    fetch("/api/site-content")
      .then((r) => r.json())
      .then((data: Record<string, string>) => {
        if (data && typeof data === "object") setContents(data);
      })
      .catch(() => {});
  }, []);

  const toggleEditMode = useCallback(() => {
    if (isAdmin) setEditMode((prev) => !prev);
  }, [isAdmin]);

  const saveContent = useCallback(async (key: string, value: string) => {
    setContents((prev) => ({ ...prev, [key]: value }));
    await fetch("/api/site-content", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key, value }),
    });
  }, []);

  const getContent = useCallback(
    (key: string) => contents[key],
    [contents]
  );

  return (
    <InlineEditContext.Provider value={{ editMode, toggleEditMode, isAdmin, saveContent, getContent, contents }}>
      {children}
      <ContentApplier contents={contents} />
    </InlineEditContext.Provider>
  );
}
