'use client';

/**
 * LinkPreviewCard — карточка превью ссылки под сообщением.
 *
 * Варианты:
 *   domain  — bare domain (без пути), самый проработанный
 *   video   — YouTube / Vimeo / Twitch
 *   connect — путь /connect /invite
 *   about   — путь /about
 *   default — всё остальное
 */

import { useEffect, useState } from 'react';
import type { CSSProperties } from 'react';

// ─────────────────────────────────────────────────────────────
//  Types
// ─────────────────────────────────────────────────────────────

interface Preview {
  url: string;
  title: string;
  description: string;
  image: string | null;
  siteName: string;
}

type CardVariant = 'domain' | 'video' | 'connect' | 'about' | 'default';

// ─────────────────────────────────────────────────────────────
//  Tab-level cache
// ─────────────────────────────────────────────────────────────

const memo = new Map<string, Preview | null>();

// ─────────────────────────────────────────────────────────────
//  Helpers
// ─────────────────────────────────────────────────────────────

function detectVariant(url: string): CardVariant {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, ''');
    const host = u.hostname.toLowerCase();
    if (!path) return 'domain';
    if (host.includes('youtube.com') || host.includes('youtu.be') ||
        host.includes('vimeo.com')   || host.includes('twitch.tv') ||
        host.includes('rutube.ru')) return 'video';
    if (path === '/connect' || path.startsWith('/connect/') ||
        path === '/invite'  || path.startsWith('/invite/')) return 'connect';
    if (path === '/about' || path.startsWith('/about/')) return 'about';
    return 'default';
  } catch { return 'default'; }
}

interface Accent { color: string; glow: string; badge: string; label: string; }

function getAccent(hostname: string): Accent {
  const h = hostname.toLowerCase();
  if (h.includes('github') || h.includes('gitlab') || h.includes('bitbucket'))
    return { color: '#e2e4ec', glow: 'rgba(226,228,236,.07)', badge: 'rgba(226,228,236,.09)', label: 'Dev' };
  if (h.includes('youtube') || h.includes('youtu.be') || h.includes('twitch') || h.includes('vimeo'))
    return { color: '#ff5252', glow: 'rgba(255,82,82,.08)',   badge: 'rgba(255,82,82,.12)',   label: 'Video' };
  if (h.includes('twitter') || h.includes('x.com') || h.includes('instagram') || h.includes('vk.com'))
    return { color: '#1d9bf0', glow: 'rgba(29,155,240,.08)',  badge: 'rgba(29,155,240,.12)',  label: 'Social' };
  if (h.includes('notion') || h.includes('figma') || h.includes('linear'))
    return { color: '#8b7cf8', glow: 'rgba(139,124,248,.08)', badge: 'rgba(139,124,248,.12)', label: 'Tool' };
  if (h.includes('vercel') || h.includes('netlify') || h.includes('cloudflare') || h.includes('aws'))
    return { color: '#00d4c8', glow: 'rgba(0,212,200,.08)',   badge: 'rgba(0,212,200,.12)',   label: 'Cloud' };
  if (h.includes('npmjs') || h.includes('pypi') || h.includes('crates.io'))
    return { color: '#cb3837', glow: 'rgba(203,56,55,.08)',   badge: 'rgba(203,56,55,.12)',   label: 'Package' };
  if (h.includes('medium') || h.includes('dev.to') || h.includes('habr') || h.includes('substack'))
    return { color: '#f5a623', glow: 'rgba(245,166,35,.08)',  badge: 'rgba(245,166,35,.12)',  label: 'Blog' };
  if (h.includes('google') || h.includes('apple') || h.includes('microsoft'))
    return { color: '#5b9cf6', glow: 'rgba(91,156,246,.08)',  badge: 'rgba(91,156,246,.12)',  label: 'Tech' };
  return   { color: '#5b9cf6', glow: 'rgba(91,156,246,.06)',  badge: 'rgba(91,156,246,.10)',  label: 'Web' };
}

function hostname(url: string): string {
  try { return new URL(url).hostname; } catch { return url; }
}

function trimWww(h: string): string { return h.replace(/^www\./, ''); }

function urlFooterLabel(url: string): string {
  try {
    const u = new URL(url);
    return trimWww(u.hostname) + (u.pathname !== '/' ? u.pathname.replace(/\/+$/, '') : '');
  } catch { return url; }
}

// ─────────────────────────────────────────────────────────────
//  Shared atoms
// ─────────────────────────────────────────────────────────────

const cardBase: CSSProperties = {
  display: 'block', marginTop: 6, maxWidth: 440,
  background: '#13151e', border: '1px solid #1e2130',
  borderRadius: 10, overflow: 'hidden', textDecoration: 'none', cursor: 'pointer',
};

function SiteLabel({ name, color = '#5b9cf6' }: { name: string; color?: string }) {
  return (
    <p style={{ fontSize: 9.5, fontWeight: 700, letterSpacing: '.1em', textTransform: 'uppercase',
                color, marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
      {name}
    </p>
  );
}

function CardTitle({ children, lines = 2 }: { children: React.ReactNode; lines?: number }) {
  return (
    <p style={{ fontSize: 13, fontWeight: 600, color: '#dde0f0', lineHeight: 1.35, marginBottom: 3,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: lines, WebkitBoxOrient: 'vertical' }}>
      {children}
    </p>
  );
}

function CardDesc({ children }: { children: React.ReactNode }) {
  return (
    <p style={{ fontSize: 11.5, color: '#4e5270', lineHeight: 1.4,
                overflow: 'hidden', display: '-webkit-box',
                WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>
      {children}
    </p>
  );
}

function UrlFooter({ url, onDismiss }: { url: string; onDismiss: () => void }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', padding: '5px 10px',
                  background: '#0b0d14', borderTop: '1px solid #181b25', gap: 6 }}>
      <p style={{ fontSize: 9.5, color: '#2e3350', fontFamily: "'SF Mono','Fira Code',monospace",
                  flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {urlFooterLabel(url)}
      </p>
      <button
        onClick={(e) => { e.preventDefault(); e.stopPropagation(); onDismiss(); }}
        style={{ width: 16, height: 16, borderRadius: '50%', background: '#1a1d27', border: 'none',
                 cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                 color: '#3a3f58', fontSize: 9, flexShrink: 0, padding: 0 }}>
        ✕
      </button>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  VARIANT: DOMAIN — bare domain, most polished
// ─────────────────────────────────────────────────────────────

function DomainCard({ data, onDismiss }: { data: Preview; onDismiss: () => void }) {
  const host      = hostname(data.url);
  const display   = trimWww(host);
  const parts     = display.split('.');
  const tld       = parts.pop() ?? '';
  const domLabel  = parts.join('.');
  const accent    = getAccent(host);
  const faviconSrc = 'https://www.google.com/s2/favicons?domain=' + host + '&sz=64';
  const [faviconOk, setFaviconOk] = useState(true);
  const letter = display.charAt(0).toUpperCase();

  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" style={cardBase}>

      {/* ── Hero ── */}
      <div style={{
        padding: '18px 18px 14px',
        background: `radial-gradient(ellipse at 0% 60%, ${accent.glow} 0%, transparent 65%), #0e1018`,
        borderBottom: '1px solid #181b25',
        display: 'flex', alignItems: 'center', gap: 16,
        position: 'relative', overflow: 'hidden',
      }}>
        {/* grid texture */}
        <div style={{
          position: 'absolute', inset: 0, opacity: .03, pointerEvents: 'none',
          backgroundImage: 'linear-gradient(#fff 1px,transparent 1px),linear-gradient(90deg,#fff 1px,transparent 1px)',
          backgroundSize: '24px 24px',
        }} />

        {/* Big favicon */}
        <div style={{
          width: 60, height: 60, borderRadius: 14, flexShrink: 0, overflow: 'hidden',
          background: faviconOk ? '#1a1d27' : accent.badge,
          border: `1px solid ${accent.color}25`,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          boxShadow: `0 0 22px ${accent.glow}, inset 0 1px 0 rgba(255,255,255,.04)`,
          position: 'relative', zIndex: 1,
        }}>
          {faviconOk ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={faviconSrc} alt="" width={34} height={34}
                 style={{ borderRadius: 6, display: 'block' }}
                 onError={() => setFaviconOk(false)} />
          ) : (
            <span style={{ fontSize: 24, fontWeight: 800, color: accent.color, lineHeight: 1 }}>
              {letter}
            </span>
          )}
        </div>

        {/* Domain + badges */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
          <div style={{
            fontSize: 20, fontWeight: 700, color: '#e8eaf6', letterSpacing: '-0.02em',
            display: 'flex', alignItems: 'baseline', gap: 0, marginBottom: 7,
            overflow: 'hidden', whiteSpace: 'nowrap',
          }}>
            <span>{domLabel}</span>
            <span style={{ color: '#3a3f58', fontWeight: 400 }}>.</span>
            <span style={{ color: accent.color }}>{tld}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {/* Category */}
            <span style={{
              fontSize: 9.5, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase',
              background: accent.badge, border: `1px solid ${accent.color}38`,
              borderRadius: 5, padding: '2px 7px', color: accent.color,
            }}>{accent.label}</span>
            {/* HTTPS */}
            <span style={{
              display: 'flex', alignItems: 'center', gap: 4,
              fontSize: 10, fontWeight: 600, color: '#23d160',
              background: 'rgba(35,209,96,.09)', border: '1px solid rgba(35,209,96,.22)',
              borderRadius: 5, padding: '2px 7px',
            }}>
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <rect x="3" y="11" width="18" height="11" rx="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
              HTTPS
            </span>
            {/* Protocol mono */}
            <span style={{ fontSize: 10, color: '#2a2d3e', fontFamily: "'SF Mono','Fira Code',monospace" }}>
              https://
            </span>
          </div>
        </div>

        {/* Arrow */}
        <div style={{ position: 'relative', zIndex: 1, flexShrink: 0 }}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#2a2d3e" strokeWidth="2">
            <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
            <polyline points="15 3 21 3 21 9"/><line x1="10" y1="14" x2="21" y2="3"/>
          </svg>
        </div>
      </div>

      {/* ── Content ── */}
      {(data.title || data.description) && (
        <div style={{ padding: '11px 18px 13px' }}>
          {data.siteName && data.siteName !== host && (
            <SiteLabel name={data.siteName} color={accent.color} />
          )}
          {data.title && <CardTitle lines={1}>{data.title}</CardTitle>}
          {data.description && (
            <p style={{ fontSize: 12, color: '#3e4260', lineHeight: 1.5,
                        overflow: 'hidden', display: '-webkit-box',
                        WebkitLineClamp: 3, WebkitBoxOrient: 'vertical' }}>
              {data.description}
            </p>
          )}
        </div>
      )}

      <UrlFooter url={data.url} onDismiss={onDismiss} />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────
//  VARIANT: VIDEO
// ─────────────────────────────────────────────────────────────

function VideoCard({ data, onDismiss }: { data: Preview; onDismiss: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const host = hostname(data.url);
  const ac = host.includes('twitch') ? '#9146ff' : host.includes('vimeo') ? '#1ab7ea' : '#ff4444';

  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" style={cardBase}>
      <div style={{ width: '100%', height: 196, position: 'relative', overflow: 'hidden',
                    background: 'linear-gradient(135deg,#1a1d2e 0%,#0f1018 100%)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        {data.image && !imgFailed && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.image} alt="" loading="lazy" referrerPolicy="no-referrer"
               onError={() => setImgFailed(true)}
               style={{ position: 'absolute', inset: 0, width: '100%', height: '100%',
                        objectFit: 'cover', opacity: .85 }} />
        )}
        <div style={{ width: 52, height: 52, borderRadius: '50%', background: 'rgba(0,0,0,.65)',
                      border: '2px solid rgba(255,255,255,.2)', backdropFilter: 'blur(4px)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      position: 'relative', zIndex: 1, boxShadow: '0 4px 20px rgba(0,0,0,.5)' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="white" style={{ marginLeft: 3 }}>
            <path d="M8 5v14l11-7z"/>
          </svg>
        </div>
      </div>
      <div style={{ display: 'flex', padding: '10px 13px 12px', borderTop: `1px solid ${ac}22` }}>
        <div style={{ width: 3, borderRadius: 2, flexShrink: 0, marginRight: 10, alignSelf: 'stretch',
                      background: `linear-gradient(180deg,${ac} 0%,${ac}44 100%)` }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <SiteLabel name={data.siteName || host} color={ac} />
          {data.title && <CardTitle>{data.title}</CardTitle>}
          {data.description && <CardDesc>{data.description}</CardDesc>}
        </div>
      </div>
      <UrlFooter url={data.url} onDismiss={onDismiss} />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────
//  VARIANT: CONNECT
// ─────────────────────────────────────────────────────────────

function ConnectCard({ data, onDismiss }: { data: Preview; onDismiss: () => void }) {
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" style={cardBase}>
      <div style={{ padding: '12px 14px', borderBottom: '1px solid #1a2226',
                    background: 'linear-gradient(135deg,#0d1a1f,#0e1a1e)',
                    display: 'flex', alignItems: 'center', gap: 12,
                    position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                      background: 'radial-gradient(ellipse at 100% 50%,rgba(0,212,200,.07) 0%,transparent 60%)' }} />
        <div style={{ width: 40, height: 40, borderRadius: 10, flexShrink: 0, zIndex: 1,
                      background: 'rgba(0,212,200,.1)', border: '1px solid rgba(0,212,200,.2)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#00d4c8" strokeWidth="2">
            <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/>
            <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
          </svg>
        </div>
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
          <p style={{ fontSize: 13, fontWeight: 700, color: '#e2e4ec', marginBottom: 1 }}>
            {data.title || data.siteName}
          </p>
          <p style={{ fontSize: 10.5, fontWeight: 600, color: '#00d4c8', letterSpacing: '.05em', textTransform: 'uppercase' }}>
            {data.siteName} · Приглашение
          </p>
        </div>
        <div style={{ background: 'linear-gradient(135deg,rgba(0,212,200,.2),rgba(0,212,200,.08))',
                      border: '1px solid rgba(0,212,200,.3)', borderRadius: 20,
                      padding: '5px 13px', fontSize: 11, fontWeight: 700, color: '#00d4c8',
                      letterSpacing: '.04em', flexShrink: 0, position: 'relative', zIndex: 1 }}>
          Вступить
        </div>
      </div>
      {data.description && (
        <div style={{ padding: '9px 14px 11px', display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: '#23d160',
                        boxShadow: '0 0 6px rgba(35,209,96,.5)', flexShrink: 0, marginTop: 3 }} />
          <p style={{ fontSize: 12, color: '#4e5270', lineHeight: 1.45 }}>{data.description}</p>
        </div>
      )}
      <UrlFooter url={data.url} onDismiss={onDismiss} />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────
//  VARIANT: ABOUT
// ─────────────────────────────────────────────────────────────

function AboutCard({ data, onDismiss }: { data: Preview; onDismiss: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  const letter = (data.siteName || hostname(data.url)).charAt(0).toUpperCase();
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer" style={cardBase}>
      <div style={{ padding: '14px 16px 12px', borderBottom: '1px solid #1a1d2a',
                    background: 'linear-gradient(135deg,#0f1228,#131626)',
                    display: 'flex', alignItems: 'center', gap: 13,
                    position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none',
                      background: 'radial-gradient(ellipse at 0% 50%,rgba(108,99,255,.1) 0%,transparent 55%)' }} />
        {data.image && !imgFailed ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={data.image} alt="" referrerPolicy="no-referrer" onError={() => setImgFailed(true)}
               style={{ width: 48, height: 48, borderRadius: '50%', objectFit: 'cover', flexShrink: 0,
                        boxShadow: '0 0 0 2px #1e2130,0 0 18px rgba(108,99,255,.3)', position: 'relative', zIndex: 1 }} />
        ) : (
          <div style={{ width: 48, height: 48, borderRadius: '50%', flexShrink: 0, zIndex: 1,
                        background: 'linear-gradient(135deg,#6c63ff,#00d4c8)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 18, fontWeight: 800, color: 'white',
                        boxShadow: '0 0 0 2px #1e2130,0 0 18px rgba(108,99,255,.3)' }}>
            {letter}
          </div>
        )}
        <div style={{ flex: 1, minWidth: 0, position: 'relative', zIndex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 700, color: '#e8eaf6', marginBottom: 2 }}>
            {data.title || data.siteName}
          </p>
          <p style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#8b7cf8' }}>
            {data.siteName}
          </p>
        </div>
        <span style={{ background: 'rgba(108,99,255,.14)', border: '1px solid rgba(108,99,255,.25)',
                       borderRadius: 6, padding: '4px 9px', fontSize: 10, fontWeight: 700,
                       color: '#9b94ff', letterSpacing: '.04em', flexShrink: 0, zIndex: 1, position: 'relative' }}>
          О нас
        </span>
      </div>
      {data.description && (
        <div style={{ padding: '10px 16px 13px' }}>
          <p style={{ fontSize: 12, color: '#4e5270', lineHeight: 1.5 }}>{data.description}</p>
        </div>
      )}
      <UrlFooter url={data.url} onDismiss={onDismiss} />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────
//  VARIANT: DEFAULT
// ─────────────────────────────────────────────────────────────

function DefaultCard({ data, onDismiss }: { data: Preview; onDismiss: () => void }) {
  const [imgFailed, setImgFailed] = useState(false);
  return (
    <a href={data.url} target="_blank" rel="noopener noreferrer"
       style={{ ...cardBase, display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', alignItems: 'flex-start' }}>
        <div style={{ width: 3, alignSelf: 'stretch', flexShrink: 0,
                      background: 'linear-gradient(180deg,#5b9cf6 0%,#6c63ff 100%)' }} />
        <div style={{ padding: '10px 12px', flex: 1, minWidth: 0, display: 'flex', gap: 10, alignItems: 'flex-start' }}>
          {data.image && !imgFailed && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={data.image} alt="" loading="lazy" referrerPolicy="no-referrer"
                 onError={() => setImgFailed(true)}
                 style={{ width: 56, height: 56, borderRadius: 7, objectFit: 'cover',
                          flexShrink: 0, border: '1px solid #1e2130' }} />
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            {data.siteName && <SiteLabel name={data.siteName} />}
            {data.title && <CardTitle>{data.title}</CardTitle>}
            {data.description && <CardDesc>{data.description}</CardDesc>}
          </div>
        </div>
      </div>
      <UrlFooter url={data.url} onDismiss={onDismiss} />
    </a>
  );
}

// ─────────────────────────────────────────────────────────────
//  Skeleton
// ─────────────────────────────────────────────────────────────

function SkeletonCard() {
  return (
    <div style={{ marginTop: 6, maxWidth: 440, background: '#13151e', border: '1px solid #1a1d27',
                  borderRadius: 10, overflow: 'hidden', display: 'flex', alignItems: 'flex-start' }}>
      <div style={{ width: 3, height: 72, background: '#1e2130', flexShrink: 0 }} />
      <div style={{ padding: '10px 12px', flex: 1, display: 'flex', gap: 10 }}>
        <div className="tz-skeleton" style={{ width: 56, height: 56, borderRadius: 7, flexShrink: 0 }} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7, paddingTop: 4 }}>
          <div className="tz-skeleton" style={{ height: 8, borderRadius: 4, width: '38%' }} />
          <div className="tz-skeleton" style={{ height: 8, borderRadius: 4, width: '75%', animationDelay: '.15s' }} />
          <div className="tz-skeleton" style={{ height: 8, borderRadius: 4, width: '55%', animationDelay: '.3s' }} />
        </div>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────
//  Main export
// ─────────────────────────────────────────────────────────────

export default function LinkPreviewCard({ url }: { url: string }) {
  const [data, setData]         = useState<Preview | null>(() => memo.get(url) ?? null);
  const [loading, setLoading]   = useState(() => !memo.has(url));
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (memo.has(url)) { setData(memo.get(url) ?? null); setLoading(false); return; }
    let alive = true;
    setLoading(true);
    fetch(`/api/link-preview?url=${encodeURIComponent(url)}`, { credentials: 'include' })
      .then((r) => r.ok ? r.json() : null)
      .then((d: Preview | null) => {
        const val = d && (d.title || d.description || d.image) ? d : null;
        memo.set(url, val);
        if (alive) { setData(val); setLoading(false); }
      })
      .catch(() => { memo.set(url, null); if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [url]);

  if (dismissed) return null;
  if (loading)   return <SkeletonCard />;
  if (!data)     return null;

  const variant = detectVariant(data.url);
  const dismiss = () => setDismissed(true);

  switch (variant) {
    case 'domain':  return <DomainCard  data={data} onDismiss={dismiss} />;
    case 'video'  : return <VideoCard   data={data} onDismiss={dismiss} />;
    case 'connect': return <ConnectCard data={data} onDismiss={dismiss} />;
    case 'about'  : return <AboutCard   data={data} onDismiss={dismiss} />;
    default         : return <DefaultCard data={data} onDismiss={dismiss} />;
  }
}

/** Первая ссылка в тексте — разворачиваем только её. */
export function firstLink(text: string): string | null {
  const match = /https?:\/\/[^\s<>"']+/i.exec(text);
  if (!match) return null;
  return match[0].replace(/[.,;:!?)[\]]+$/, '');
}
