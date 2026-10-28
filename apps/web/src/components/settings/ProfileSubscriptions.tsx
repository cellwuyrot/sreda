"use client";
import type { ReactNode } from "react";
import BusinessSubscriptionActions from "@/components/subscriptions/BusinessSubscriptionActions";
import { PREMIUM_KEY_FEATURES, PREMIUM_MAIN_ADVANTAGE } from "@/lib/premiumFeatures";
import PremiumFeatureIcon from "@/components/premium/PremiumFeatureIcon";
export type SubscriptionProfile = {
  premium?: { active: boolean; source: "none" | "role" | "subscription"; plan: string | null; startedAt: string | null; expiresAt: string | null; daysLeft?: number | null; granted: boolean };
  vpn?: { active: boolean; expiresAt: string | null; daysLeft?: number | null; viaPremium: boolean };
};
function Section({ title, subtitle, children }: { title: string; subtitle?: string; dense?: boolean; children: ReactNode }) {
  return <section className="mb-6" aria-label={title}><h2 className="text-xl font-semibold text-neutral-900 dark:text-white">{title}</h2>{subtitle && <p className="mb-3 mt-1 text-sm text-neutral-600 dark:text-gray-300">{subtitle}</p>}{children}</section>;
}
/** «1 день», «2 дня», «5 дней» — счётчик подписки читают глазами, не парсером. */
function pluralDays(n: number): string {
  const abs = Math.abs(n) % 100;
  const last = abs % 10;
  if (abs > 10 && abs < 20) return "дней";
  if (last > 1 && last < 5) return "дня";
  if (last === 1) return "день";
  return "дней";
}

export default function ProfileSubscriptions({ profile, effectivePremium }: { profile: SubscriptionProfile; effectivePremium: boolean }) {

        // Status and access live here; checkout and manual settlement live only in Business.
        const premiumInfo = profile.premium;
        const expiresAt = premiumInfo?.expiresAt ? new Date(premiumInfo.expiresAt) : null;
        /* Счётчик считает сервер: у него одна дата на всех, а браузер может стоять
           с любым временем. Локальный расчёт — запасной путь для старых сборок. */
        const daysLeft = premiumInfo?.daysLeft ?? (expiresAt ? Math.ceil((expiresAt.getTime() - Date.now()) / 86_400_000) : null);
        const byRole = premiumInfo?.source === "role";
        /* Срок вышел, а флаг в базе ещё не снят: задача проверяет раз в шесть часов.
           В этом окне показываем правду, а не «подписка без срока». */
        const overdue = daysLeft != null && daysLeft < 0;
        const premiumActive = effectivePremium && !overdue;
        const dateLabel = expiresAt?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
        const premiumLine = !premiumActive
          ? overdue
            ? `Срок вышел ${dateLabel} — обычные ограничения вернулись.`
            : "Сейчас обычный профиль."
          : byRole
            ? "Доступ по роли — оплата не требуется."
            : daysLeft == null
              ? premiumInfo?.granted ? "Бессрочно, оформлена администратором." : "Бессрочно."
              : `Осталось ${daysLeft} ${pluralDays(daysLeft)} — до ${dateLabel}.`;

        /* Подписка «только VPN»: даёт РОВНО одно право — включать туннель. */
        const vpnInfo = profile.vpn;
        const vpnExpires = vpnInfo?.expiresAt ? new Date(vpnInfo.expiresAt) : null;
        const vpnDays = vpnInfo?.daysLeft ?? (vpnExpires ? Math.ceil((vpnExpires.getTime() - Date.now()) / 86_400_000) : null);
        const vpnOverdue = vpnDays != null && vpnDays < 0;
        const vpnPlanActive = !!vpnInfo?.active && !vpnOverdue;
        const vpnViaPremium = !!vpnInfo?.viaPremium || (premiumActive && !vpnInfo);
        const vpnDateLabel = vpnExpires?.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
        const vpnLine = vpnPlanActive
          ? vpnDays == null
            ? "Бессрочно."
            : `Осталось ${vpnDays} ${pluralDays(vpnDays)} — до ${vpnDateLabel}.`
          : vpnOverdue
            ? `Срок вышел ${vpnDateLabel} — туннель отключён.`
            : vpnViaPremium
              ? "Отдельная подписка не нужна: надёжное соединение входит в Premium."
              : "Только надёжное соединение для ваших устройств, без остальных возможностей Premium.";

        return (
          <>
            {/* ── Блок 1. Только VPN ───────────────────────────────────── */}
            <Section dense title="Надёжное соединение" subtitle="Подключение устройств и управление доступом">
              <div className={`rounded-2xl border p-4 ${vpnPlanActive ? "border-cyan-500/25 bg-cyan-500/5" : "border-neutral-200 dark:border-white/10"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-white">
                      {vpnPlanActive ? "Подписка действует" : vpnViaPremium ? "Доступ есть по Premium" : "Подписки нет"}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-gray-400">{vpnLine}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${vpnPlanActive ? "bg-cyan-500/15 text-cyan-500" : vpnViaPremium ? "bg-amber-500/15 text-amber-500" : "bg-neutral-200 dark:bg-white/10 text-neutral-500 dark:text-gray-400"}`}>
                    {vpnPlanActive ? "Активна" : vpnViaPremium ? "По Premium" : "Нет"}
                  </span>
                </div>

                {/* Главное о подписке — четыре строки вместо абзацев. Строка «не входит»
                    здесь не мелкий шрифт, а самое важное: именно из-за неё не будет
                    обращений вроде «оплатил VPN, а темы не появились». */}
                <ul className="mt-3 space-y-1.5 text-sm">
                  <li className="flex gap-2 text-neutral-600 dark:text-gray-300">
                    <span className="text-cyan-500">✓</span>
                    <span>Кнопка «TZ» в TZ.Connect — выбор сервера и срок подписки</span>
                  </li>
                  <li className="flex gap-2 text-neutral-600 dark:text-gray-300">
                    <span className="text-cyan-500">✓</span>
                    <span>Выбор, что идёт через туннель: всё соединение или только сервис</span>
                  </li>
                  <li className="flex gap-2 text-neutral-600 dark:text-gray-300">
                    <span className="text-cyan-500">✓</span>
                    <span>Конфигурация WireGuard для телефона и компьютера</span>
                  </li>
                  <li className="flex gap-2 text-neutral-500 dark:text-gray-400">
                    <span className="text-neutral-400">—</span>
                    <span>Не входит ничего из Premium: ни оформление, ни лимиты сообществ, ни качество голоса</span>
                  </li>
                </ul>

                {!vpnViaPremium && <div className="mt-4"><BusinessSubscriptionActions kind="VPN" active={vpnPlanActive} /></div>}

                {(vpnPlanActive || vpnViaPremium) && (
                  <a href="/connect" className="mt-3 inline-flex min-h-11 items-center rounded-xl bg-cyan-500/15 px-3 py-1.5 text-sm font-medium text-cyan-700 hover:bg-cyan-500/25 dark:text-cyan-400">
                    Включить в TZ.Connect →
                  </a>
                )}



              </div>
            </Section>

            {/* ── Блок 2. Premium ─────────────────────────────────────── */}
            <Section dense title="Premium" subtitle="Все возможности сервиса, включая надёжное соединение">
              <div className={`rounded-2xl border p-4 ${premiumActive ? "border-amber-500/25 bg-amber-500/5" : "border-neutral-200 dark:border-white/10"}`}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-neutral-900 dark:text-white">
                      {premiumActive ? (byRole ? "Доступ по роли" : "Подписка действует") : "Подписки нет"}
                    </p>
                    <p className="mt-0.5 text-sm text-neutral-500 dark:text-gray-400">{premiumLine}</p>
                  </div>
                  <span className={`shrink-0 rounded-full px-3 py-1 text-sm font-medium ${premiumActive ? "bg-amber-500/15 text-amber-500" : "bg-neutral-200 dark:bg-white/10 text-neutral-500 dark:text-gray-400"}`}>
                    {premiumActive ? "Активен" : "Нет"}
                  </span>
                </div>

                {/* Главное преимущество — одной строкой, остальное — перечислением. */}
                <p className="mt-3 text-sm font-medium text-amber-700 dark:text-amber-400">{PREMIUM_MAIN_ADVANTAGE.title}</p>
                <ul className="mt-2 space-y-1.5 text-sm">
                  {PREMIUM_KEY_FEATURES.map((f) => (
                    <li key={f.id} className="flex items-start gap-2 text-neutral-600 dark:text-gray-300">
                      <span className="mt-0.5 text-amber-500"><PremiumFeatureIcon id={f.id} size={13} /></span>
                      <span>{f.title}</span>
                    </li>
                  ))}
                  <li className="flex items-start gap-2 text-neutral-600 dark:text-gray-300">
                    <span className="text-amber-500">✓</span>
                    <span>Надёжное соединение входит в Premium — отдельно оплачивать его не нужно</span>
                  </li>
                </ul>

                {!byRole && <div className="mt-4"><BusinessSubscriptionActions kind="PREMIUM" active={premiumActive} /></div>}

                {byRole && <p className="mt-3 text-sm text-neutral-500 dark:text-gray-400">Подписка дана ролью в команде: платить ничего не нужно, срока у неё нет.</p>}


              </div>
            </Section>
          </>
        );
      
}
