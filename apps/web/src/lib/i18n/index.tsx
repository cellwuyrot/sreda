"use client";

// FIX-I18N: lightweight app-wide localization (RU -> EN).
// - Russian is the source language: UI strings are hardcoded in Russian across the app.
// - English is produced at runtime by <AutoTranslator/>: it walks the DOM and replaces
//   whole text nodes and attribute values (placeholder/title/aria-label/alt) using the
//   RU_EN dictionary + PATTERNS, and keeps translating while the UI updates
//   (MutationObserver). Natural fixpoint: translated text has no Cyrillic, so it is
//   never re-processed.
// - User-generated content is protected: TEXTAREA, contentEditable and any subtree
//   marked with `data-i18n-skip` are never touched.
// - The language is stored in localStorage ("tz-lang") and toggled from
//   Settings -> Appearance (Внешний вид).

import {
  ReactNode,
  createContext,
  useContext,
  useEffect,
  useState,
} from "react";
import { RU_EN, PATTERNS } from "./dictionary";

export type Lang = "ru" | "en";

const CYRILLIC = /[\u0400-\u04FF]/;
const STORAGE_KEY = "tz-lang";

const LangContext = createContext<{ lang: Lang; setLang: (l: Lang) => void }>({
  lang: "ru",
  setLang: () => {},
});

export function useLang() {
  return useContext(LangContext);
}

/** Translate one string. The whole trimmed value must match a dictionary key or pattern. */
export function translateText(raw: string): string {
  if (!raw || !CYRILLIC.test(raw)) return raw;
  const lead = raw.match(/^\s*/)![0];
  const trail = raw.match(/\s*$/)![0];
  if (lead.length === raw.length) return raw;
  const core = raw.slice(lead.length, raw.length - trail.length);
  let hit = RU_EN[core];
  if (hit === undefined) hit = RU_EN[core.replace(/\s+/g, " ")];
  if (hit !== undefined) return lead + hit + trail;
  for (const [re, tpl] of PATTERNS) {
    const m = core.match(re);
    if (m) return lead + tpl(m) + trail;
  }
  return raw;
}

const ATTRS = ["placeholder", "title", "aria-label", "alt"];

function skipped(el: Element | null): boolean {
  for (let n: Element | null = el; n; n = n.parentElement) {
    const tag = n.tagName;
    if (tag === "SCRIPT" || tag === "STYLE" || tag === "TEXTAREA") return true;
    if (n.hasAttribute("data-i18n-skip")) return true;
  }
  if (el && (el as HTMLElement).isContentEditable) return true;
  return false;
}

function AutoTranslator({ lang }: { lang: Lang }) {
  useEffect(() => {
    if (lang !== "en" || typeof document === "undefined") return;

    // Originals are kept so switching back to Russian restores the exact text
    // without waiting for React to re-render.
    const textOriginals = new Map<Text, string>();
    const attrOriginals = new Map<Element, Record<string, string>>();

    const doText = (node: Text) => {
      const raw = node.nodeValue;
      if (!raw || !CYRILLIC.test(raw)) return;
      if (skipped(node.parentElement)) return;
      const out = translateText(raw);
      if (out !== raw) {
        if (!textOriginals.has(node)) textOriginals.set(node, raw);
        node.nodeValue = out;
      }
    };

    const doAttrs = (el: Element) => {
      if (skipped(el)) return;
      for (const a of ATTRS) {
        const v = el.getAttribute(a);
        if (!v || !CYRILLIC.test(v)) continue;
        const out = translateText(v);
        if (out !== v) {
          const bag = attrOriginals.get(el) ?? {};
          if (!(a in bag)) {
            bag[a] = v;
            attrOriginals.set(el, bag);
          }
          el.setAttribute(a, out);
        }
      }
    };

    const walk = (root: Node) => {
      if (root.nodeType === Node.TEXT_NODE) {
        doText(root as Text);
        return;
      }
      if (root.nodeType !== Node.ELEMENT_NODE) return;
      doAttrs(root as Element);
      const tw = document.createTreeWalker(
        root,
        NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT,
      );
      let n: Node | null = tw.nextNode();
      while (n) {
        if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
        else doAttrs(n as Element);
        n = tw.nextNode();
      }
    };

    walk(document.body);
    if (document.title && CYRILLIC.test(document.title)) {
      document.title = translateText(document.title);
    }

    const mo = new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === "characterData") doText(m.target as Text);
        else if (m.type === "childList") m.addedNodes.forEach((n) => walk(n));
        else if (m.type === "attributes" && m.target.nodeType === Node.ELEMENT_NODE)
          doAttrs(m.target as Element);
      }
    });
    mo.observe(document.body, {
      subtree: true,
      childList: true,
      characterData: true,
      attributes: true,
      attributeFilter: ATTRS,
    });

    return () => {
      mo.disconnect();
      textOriginals.forEach((orig, node) => {
        if (node.isConnected) node.nodeValue = orig;
      });
      attrOriginals.forEach((bag, el) => {
        if (!el.isConnected) return;
        for (const [a, v] of Object.entries(bag)) el.setAttribute(a, v);
      });
    };
  }, [lang]);

  return null;
}

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("ru");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "ru") setLangState(saved);
    } catch {}
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);

  const setLang = (l: Lang) => {
    setLangState(l);
    try {
      localStorage.setItem(STORAGE_KEY, l);
    } catch {}
  };

  return (
    <LangContext.Provider value={{ lang, setLang }}>
      {children}
      <AutoTranslator lang={lang} />
    </LangContext.Provider>
  );
}
