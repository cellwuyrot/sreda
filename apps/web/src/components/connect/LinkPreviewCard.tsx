"use client";

import { useEffect, useState, type CSSProperties } from "react";
import { linkAccent } from "@/lib/linkPreviewPolicy";
export { firstLink } from "@/lib/linkPreviewPolicy";
export interface Preview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
  favicon?: string | null;
  themeColor?: string | null;
}
const cache = new Map<string, { value: Preview | null; until: number }>();
const pending = new Map<string, Promise<Preview | null>>();
export async function loadLinkPreview(url: string): Promise<Preview | null> {
  const old = cache.get(url);
  if (old && old.until > Date.now()) return old.value;
  const flight = pending.get(url);
  if (flight) return flight;
  const request = fetch("/api/link-preview?url=" + encodeURIComponent(url), {
    credentials: "include",
    signal: AbortSignal.timeout(10000),
  })
    .then(async (r) => (r.ok ? ((await r.json()) as Preview) : null))
    .catch(() => null)
    .then((value) => {
      if (cache.size >= 200) cache.delete(cache.keys().next().value!);
      cache.set(url, { value, until: Date.now() + (value ? 300000 : 15000) });
      pending.delete(url);
      return value;
    });
  pending.set(url, request);
  return request;
}
function proxyImage(value: string | null | undefined) {
  return typeof value === "string" &&
    value.startsWith("/api/link-preview/image?url=")
    ? value
    : null;
}
function destination(value: string) {
  try {
    const u = new URL(value);
    return ["http:", "https:"].includes(u.protocol) ? u : null;
  } catch {
    return null;
  }
}
export function PreviewContent({
  data,
  compact = false,
}: {
  data: Preview;
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false),
    [iconFailed, setIconFailed] = useState(false),
    [small, setSmall] = useState(false);
  useEffect(() => {
    setFailed(false);
    setIconFailed(false);
    setSmall(false);
  }, [data.url, data.image, data.favicon]);
  const target = destination(data.url);
  if (!target) return null;
  const image = proxyImage(data.image),
    icon = proxyImage(data.favicon);
  return (
    <a
      href={target.href}
      target="_blank"
      rel="noopener noreferrer"
      className={`link-preview-content ${compact || small ? "is-compact" : ""}`}
    >
      {image && !failed && (
        <div className="link-preview-media">
          {/* Remote images are fetched only through our authenticated SSRF-protected proxy. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={image}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={() => setFailed(true)}
            onLoad={(e) => {
              const i = e.currentTarget;
              if (i.naturalWidth < 240 || i.naturalHeight < 120) setSmall(true);
            }}
          />
        </div>
      )}
      <div className="link-preview-copy">
        <div className="link-preview-domain">
          {icon && !iconFailed ? (
            <>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={icon}
                alt=""
                width={18}
                height={18}
                loading="lazy"
                onError={() => setIconFailed(true)}
              />
            </>
          ) : (
            <span aria-hidden="true" className="link-preview-monogram">
              {target.hostname[0].toUpperCase()}
            </span>
          )}
          <span>{target.hostname.replace(/^www\./, "")}</span>
          <span aria-hidden="true" className="ml-auto">
            ↗
          </span>
        </div>
        <div className="link-preview-title">
          {data.title || data.siteName || target.hostname}
        </div>
        {data.description && (
          <p className="link-preview-description">{data.description}</p>
        )}
      </div>
    </a>
  );
}
export default function LinkPreviewCard({
  url,
  compact = false,
}: {
  url: string;
  compact?: boolean;
}) {
  const [data, setData] = useState<Preview | null>(null),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    let alive = true;
    setData(null);
    setLoading(true);
    const timer = setTimeout(() => {
      void loadLinkPreview(url).then((value) => {
        if (alive) {
          setData(value);
          setLoading(false);
        }
      });
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [url]);
  if (loading)
    return (
      <div
        aria-label="Загрузка превью ссылки"
        className="link-preview-skeleton"
      />
    );
  if (!data) return null;
  return (
    <div
      className="link-preview-card"
      style={
        {
          "--link-accent": linkAccent(data.url, data.themeColor),
        } as CSSProperties
      }
    >
      <PreviewContent data={data} compact={compact} />
    </div>
  );
}
