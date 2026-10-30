"use client";
import { useEffect, useState } from "react";
import { VPN_HEALTH_FIELDS, vpnHealthView } from "@/lib/vpnNodeHealth";
const LABELS = {
  vpnInterface: "Интерфейс UP",
  vpnListener: "Порт интерфейса совпадает",
  vpnForwarding: "Пересылка IPv4",
  vpnNat: "NAT VPN-подсети",
  vpnForwardOut: "FORWARD к интернет-интерфейсу",
  vpnForwardIn: "FORWARD обратно к VPN",
  vpnUdp: "Правило входящего UDP",
};
export default function VpnNodeHealth({
  report,
  online,
}: {
  report: Record<string, unknown> | null;
  online: boolean;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const { health, fresh, status } = vpnHealthView(report, online, now);
  return (
    <section
      aria-label="Диагностика сети VPN"
      className="mt-3 rounded-xl border border-neutral-200 p-3 text-xs dark:border-white/15"
    >
      <div className="flex items-center gap-2 font-medium">
        <span>
          Сеть VPN:{" "}
          {status === "ready"
            ? "настройки проверены"
            : status === "degraded"
              ? "требует внимания"
              : fresh
                ? "проверка неполная"
                : "нет свежей диагностики"}
        </span>
      </div>
      {status === "degraded" && (
        <p role="status" className="mt-2 text-amber-700 dark:text-amber-300">
          Неполная настройка сети. Если отсутствует NAT, рукопожатие может
          проходить без доступа в интернет.
        </p>
      )}
      {fresh && status === "unknown" && (
        <p role="status" className="mt-2 text-amber-700 dark:text-amber-300">
          Часть проверок не выполнена. Проверьте права агента и доступность
          системных утилит на узле.
        </p>
      )}
      {!fresh ? (
        <p className="mt-2 text-neutral-500 dark:text-gray-400">
          Нужен свежий отчёт обновлённого агента. Действующий доступ
          пользователей не изменяется.
        </p>
      ) : (
        <>
          <dl className="mt-2 space-y-1">
            {VPN_HEALTH_FIELDS.map((field) => (
              <div
                key={field}
                className="flex flex-wrap justify-between gap-x-3"
              >
                <dt>{LABELS[field]}</dt>
                <dd>
                  {health[field] === "ready"
                    ? "Есть"
                    : health[field] === "missing"
                      ? "Отсутствует"
                      : "Не удалось проверить"}
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-2 text-neutral-500 dark:text-gray-400">
            Проверено:{" "}
            {new Date(Number(health.vpnCheckedAtMs)).toLocaleString("ru-RU")}
          </p>
          <p className="mt-2 text-neutral-500 dark:text-gray-400">
            {health.vpnSubnet || "Подсеть не определена"} · выход:{" "}
            {health.vpnEgress || "не определён"}
          </p>
          <p className="mt-1">
            Автовосстановление:{" "}
            {health.vpnRepair === "disabled"
              ? "выключено"
              : health.vpnRepair === "failed"
                ? "ошибка — проверьте узел"
                : health.vpnRepair === "applied"
                  ? "правила восстановлены при последней проверке"
                  : health.vpnRepair === "unchanged"
                    ? "включено"
                    : "нет данных"}
          </p>
          <p className="mt-2">
            Клиентов с рукопожатием за 3 минуты:{" "}
            {typeof health.vpnRecentPeers === "number"
              ? health.vpnRecentPeers
              : "нет данных"}
            . С ненулевыми счётчиками в обе стороны:{" "}
            {typeof health.vpnBidirectionalPeers === "number"
              ? health.vpnBidirectionalPeers
              : "нет данных"}
            .
          </p>
        </>
      )}
      <details className="mt-3">
        <summary className="cursor-pointer py-2 font-medium">
          (?) Что проверяется и как восстановить
        </summary>
        <p className="mt-2 leading-relaxed">
          «На связи» означает только отчёты агента. Правила могут
          присутствовать, но пакеты могут блокироваться выше них, у провайдера
          либо из-за DNS/MTU. Старый агент или просроченная проверка — не
          исправность, а отсутствие данных.
        </p>
        <p className="mt-2 leading-relaxed">
          Обновите apps/vpn и deploy на дочернем сервере. Команды просмотра,
          включения восстановления и отката:
          docs/updates/vpn-node-network-health.md. Автовосстановление включается
          локально на узле; удалённых команд управления в этой панели нет.
        </p>
      </details>
      <p className="mt-2 text-neutral-500 dark:text-gray-400">
        Это проверка конфигурации, не гарантия работы интернета. Счётчики могут
        относиться к прошлым соединениям; при отсутствии клиентов рукопожатий
        может не быть.
      </p>
    </section>
  );
}
