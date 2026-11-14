'use client';
import { useCallback, useEffect, useState } from 'react';
import { getAndroidTrustTunnelPilot, type PilotStatus } from '@/lib/androidTrustTunnelPilot';

/** Separate from subscriptions and group admin: server verifies project ADMIN. */
export default function TrustTunnelPilotPanel() {
  const [eligible, setEligible] = useState(false);
  const [ready, setReady] = useState(false);
  const [status, setStatus] = useState<PilotStatus | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const refresh = useCallback(async () => {
    const bridge = getAndroidTrustTunnelPilot();
    if (!bridge) return;
    try { setStatus(await bridge.status()); } catch { /* Do not expose private data. */ }
  }, []);
  useEffect(() => {
    if (!getAndroidTrustTunnelPilot()) return;
    let alive = true;
    fetch('/api/vpn/trusttunnel/pilot', { cache: 'no-store' }).then(async r => r.ok ? r.json() : null)
      .then(data => { if (alive && data?.eligible === true) { setEligible(true); setReady(data.connectionReady === true); } })
      .catch(() => {});
    void refresh(); const timer = setInterval(() => void refresh(), 2000);
    return () => { alive = false; clearInterval(timer); };
  }, [refresh]);
  const active = status?.state === 'on' || status?.state === 'connecting' || status?.state === 'disconnecting';
  if (!getAndroidTrustTunnelPilot() || (!eligible && !active)) return null;
  const toggle = async () => {
    const bridge = getAndroidTrustTunnelPilot(); if (!bridge || busy) return;
    setBusy(true); setMessage('');
    try {
      if (active) setStatus(await bridge.down());
      else {
        const response = await fetch('/api/vpn/trusttunnel/pilot/config', { method: 'POST', cache: 'no-store' });
        if (!response.ok) throw new Error('Не удалось получить тестовый профиль. Проверьте доступ администратора.');
        const data: unknown = await response.json();
        if (!data || typeof data !== 'object' || !('config' in data) || typeof data.config !== 'string') throw new Error('Некорректный тестовый профиль');
        setStatus(await bridge.up(data.config));
      }
    } catch { setMessage('Не удалось выполнить действие. Проверьте доступ и состояние VPN.'); }
    finally { setBusy(false); }
  };
  return <section className="mx-6 my-4 rounded-2xl border border-amber-400 p-4 text-neutral-900 dark:text-white">
    <h3 className="font-semibold">TrustTunnel — тест для администрации проекта</h3>
    <p className="mt-2 text-sm">{active ? (status?.state === 'on' ? 'Подключён' : 'Подключение или отключение…') : ready ? 'Тестовый профиль доступен' : 'Тестовый профиль пока не подготовлен'}</p>
    {(message || status?.error) && <p role="alert" className="mt-2 text-sm">{message || status?.error}</p>}
    <button type="button" disabled={busy || (!active && !ready)} onClick={toggle} className="mt-3 min-h-11 rounded-xl border px-4 disabled:opacity-50">{active ? 'Отключить' : 'Подключить тестовый VPN'}</button>
  </section>;
}
