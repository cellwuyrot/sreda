"use client";
import type { ReactNode } from "react";
import BusinessSubscriptionActions from "@/components/subscriptions/BusinessSubscriptionActions";
import { PREMIUM_KEY_FEATURES, PREMIUM_MAIN_ADVANTAGE } from "@/lib/premiumFeatures";
import PremiumFeatureIcon from "@/components/premium/PremiumFeatureIcon";
export type SubscriptionProfile = {
  premium?: { active: boolean; source: "none" | "role" | "subscription"; plan: string | null; startedAt: string | null; expiresAt: string | null; daysLeft?: number | null; granted: boolean };
  vpn?: { active: boolean; expiresAt: string | null; daysLeft?: number | null; viaPremium: boolean };
};
type PaymentMethods = { methods: { id: string; label: string; fields: { label: string; value: string }[]; link?: string }[] };
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

export default function ProfileSubscriptions({ profile, effectivePremium, paymentMethods = null }: { profile: SubscriptionProfile; effectivePremium: boolean; paymentMethods?: PaymentMethods | null }) {

        /* VPN-PLAN: раздел — ровно два блока: «Только VPN» и «Premium».

           Прежняя верстка была витриной: преимущество, список возможностей,
           таблица сравнения с обычным профилем и два блока оплаты. В настройках
           человек решает другую задачу: понять, что у него есть и до какого числа.
           Поэтому остались две карточки со статусом, а реквизиты спрятаны под
           строку «Как оплатить» — они нужны один раз в месяц, а не каждый вход. */
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

        /* Реквизиты у обеих подписок одни и те же, различается только комментарий
           к платежу — именно по нему администратор поймёт, что подключать. */
        const payDetails = (hint: string) => (
          <details className="mt-3 rounded-xl border border-neutral-200 dark:border-white/10">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-neutral-600 dark:text-gray-300">Реквизиты для ручной оплаты</summary>
            <div className="space-y-2 px-3 pb-3">
              {paymentMethods && paymentMethods.methods.length > 0 ? (
                <>
                  {paymentMethods.methods.map((m) => (
                    <div key={m.id} className="rounded-lg bg-neutral-50 dark:bg-white/5 p-2.5">
                      <p className="text-sm font-semibold text-neutral-900 dark:text-white">{m.label}</p>
                      {m.fields.map((f) => (
                        <div key={f.label} className="mt-1 flex items-center justify-between gap-3 text-sm">
                          <span className="text-neutral-400">{f.label}</span>
                          <span className="font-medium text-neutral-700 dark:text-gray-200 text-right break-all">{f.value}</span>
                        </div>
                      ))}
                      {m.link && (
                        <a href={m.link} target="_blank" rel="noopener noreferrer" className="mt-2 inline-flex text-sm font-medium text-violet-600 dark:text-cyan-400 hover:underline">
                          Перейти к оплате →
                        </a>
                      )}
                    </div>
                  ))}
                  <p className="text-sm text-neutral-400">{hint}</p>
                </>
              ) : (
                <p className="text-sm text-neutral-500 dark:text-gray-400">Способы оплаты пока не настроены — напишите администратору.</p>
              )}
            </div>
          </details>
        );


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
                {!vpnViaPremium && !!paymentMethods?.methods.length && payDetails(vpnPlanActive
                  ? "Для продления укажите в комментарии к платежу username и «Интернет»."
                  : "В комментарии к платежу укажите username и «Интернет» — иначе платёж примут за Premium.")}


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

                {byRole ? (
                  <p className="mt-3 text-sm text-neutral-500 dark:text-gray-400">Подписка дана ролью в команде: платить ничего не нужно, срока у неё нет.</p>
                ) : (
                  !!paymentMethods?.methods.length && payDetails(premiumActive
                    ? "Для продления укажите в комментарии к платежу ваш username."
                    : "В комментарии к платежу укажите ваш username — по нему администратор найдёт аккаунт.")
                )}


              </div>
            </Section>
          </>
        );
      
}
