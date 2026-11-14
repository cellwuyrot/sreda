'use client';
import { useCallback, useEffect, useState } from 'react';
import { getTrustTunnelEngine } from '@/lib/trustTunnelClient';
import type { PilotStatus } from '@/lib/androidTrustTunnelPilot';

type Access = { available: boolean; eligible: boolean; enabled: boolean; applied: boolean; agentError?: boolean };

/** A profile is issued only on action and is never rendered or stored in the web UI. */
export default function TrustTunnelPilotPanel() {
  const [access, setAccess] = useState<Access | null>(null);
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refreshAccess = useCallback(async () => {
    try {
      const r = await fetch('/api/vpn/trusttunnel', { cache: 'no-store' });
      if (!r.ok) { setAccess(null); return; }
      const data = await r.json();
      setAccess({ available: data.available === true, eligible: data.eligible === true,
        enabled: data.enabled === true, applied: data.applied === true, agentError: data.agentError === true });
    } catch { setAccess(null); }
  }, []);
  const refreshEngine = useCallback(async () => {
    const engine = getTrustTunnelEngine(); if (!engine) return;
    try { setStatus(await engine.status()); } catch { /* status can be refreshed later */ }
  }, []);
  useEffect(() => {
    if (!getTrustTunnelEngine()) return;
    void refreshAccess(); void refreshEngine();
    const timer = setInterval(() => { void refreshAccess(); void refreshEngine(); }, 5000);
    return () => clearInterval(timer);
  }, [refreshAccess, refreshEngine]);
  const active = status?.state === 'on' || status?.state === 'connecting' || status?.state === 'disconnecting';
  if (!getTrustTunnelEngine() || (!access?.eligible && !active && status?.state !== 'error')) return null;
  const issue = async (rotate: boolean) => {
    const engine = getTrustTunnelEngine(); if (!engine || busy) return;
    if (rotate && !window.confirm('Обновить ключ TrustTunnel? Старый ключ перестанет работать после синхронизации.')) return;
    setBusy(true); setMessage('');
    try {
      const response = await fetch('/api/vpn/trusttunnel/config', { method: 'POST', cache: 'no-store',
        headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ rotate }) });
      if (!response.ok) throw new Error('issue');
      const data: unknown = await response.json();
      if (!data || typeof data !== 'object' || !('config' in data) || typeof data.config !== 'string' || !('applied' in data)) throw new Error('profile');
      await refreshAccess();
      if (data.applied !== true) {
        setMessage('Профиль отправлен на активацию. Обычно это занимает до двух минут; дождитесь готовности и нажмите «Подключить».');
      } else if (rotate) {
        setMessage('Ключ обновлён. Теперь можно подключиться.');
      } else setStatus(await engine.up(data.config));
    } catch { setMessage('Не удалось подготовить подключение. Проверьте доступ и состояние сервиса.'); }
    finally { setBusy(false); }
  };
  const disconnect = async () => {
    const engine = getTrustTunnelEngine(); if (!engine || busy) return;
    setBusy(true); setMessage('');
    try { setStatus(await engine.down()); } catch { setMessage('Не удалось отключить VPN. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  };
  const revoke = async () => {
    if (busy || !window.confirm('Отключить доступ TrustTunnel? Ключ будет отозван при следующей синхронизации.')) return;
    setBusy(true); setMessage('');
    try {
      const r = await fetch('/api/vpn/trusttunnel/config', { method: 'DELETE', cache: 'no-store' });
      if (!r.ok) throw new Error('revoke');
      await refreshAccess(); setMessage('Доступ будет отозван при следующей синхронизации.');
    } catch { setMessage('Не удалось отключить доступ. Попробуйте ещё раз.'); }
    finally { setBusy(false); }
  };
  return <section className="mx-6 my-4 rounded-2xl border border-amber-400 p-4 text-neutral-900 dark:text-white">
    <h3 className="font-semibold">TrustTunnel — надёжное соединение</h3>
    <p className="mt-2 text-sm">{active ? (status?.state === 'on' ? 'Служба подключена' : 'Подключение или отключение…') :
      !access?.available ? 'Сервис временно недоступен' : !access.eligible ? 'Доступ по подписке неактивен' :
      access.agentError ? 'Ошибка синхронизации сервера' : access.enabled && !access.applied ? 'Ожидание активации на сервере' :
      access.enabled && access.applied ? 'Профиль готов' : 'Профиль ещё не активирован'}</p>
    {(message || status?.error) && <p role="alert" className="mt-2 text-sm">{message || status?.error}</p>}
    {(active || status?.state === 'error') && <button type="button" disabled={busy} onClick={disconnect} className="mt-3 min-h-11 rounded-xl border px-4 disabled:opacity-50">Отключить</button>}
    {!active && <button type="button" disabled={busy || !access?.available || !access?.eligible || (access.enabled && !access.applied)} onClick={() => void issue(false)} className="mt-3 min-h-11 rounded-xl border px-4 disabled:opacity-50">Подключить</button>}
    {!active && access?.eligible && access.enabled && <div className="mt-2 flex gap-2">
      <button type="button" disabled={busy} onClick={() => void issue(true)} className="min-h-11 rounded-xl border px-4 disabled:opacity-50">Обновить ключ</button>
      <button type="button" disabled={busy} onClick={revoke} className="min-h-11 rounded-xl border px-4 disabled:opacity-50">Отозвать доступ</button>
    </div>}
  </section>;
}
