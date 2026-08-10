/**
 * BUSINESS-SUB: логика движения счёта бизнес-разговора — разового и по подписке.
 *
 * ── Зачем это вынесено в отдельный чистый модуль ───────────────────────
 *
 * Порядок шагов оплаты — единственное место в проекте, где ошибка стоит денег,
 * а не кривого отступа. Здесь нет ни Prisma, ни сети, ни React — только функции
 * от данных к данным. Благодаря этому один и тот же код проверяет и сервер,
 * и интерфейс, и тесты — без базы данных и без сгенерированного клиента.
 *
 * ── Порядок шагов ──────────────────────────────────────────────
 *
 *   UNPAID  — счёт выставлен, клиент ещё не подписал документы;
 *   SIGNED  — подписал, можно платить;
 *   AWAITING— клиент заявил об оплате, администрация проверяет;
 *   PAID    — поступление подтверждено администрацией.
 *
 * В подписке цепочка та же, но замкнутая: после PAID счёт живёт до `nextDueAt`,
 * а когда срок наступает — возвращается в SIGNED, а не в UNPAID: документы уже
 * подписаны, и заставлять подписывать те же бумаги каждый месяц было бы
 * издевательством. Переподписание требуется только при изменении условий счёта
 * — это делает маршрут админки, сбрасывая подпись.
 */

import { PAYMENT_STATUSES, type PaymentStatus } from "./businessPayment";

/* ── Способ выставления ───────────────────────────────────── */

export const PAYMENT_MODES = ["ONE_TIME", "SUBSCRIPTION"] as const;
export type PaymentMode = (typeof PAYMENT_MODES)[number];

export function isPaymentMode(value: unknown): value is PaymentMode {
  return typeof value === "string" && (PAYMENT_MODES as readonly string[]).includes(value);
}

export const BILLING_PERIODS = ["MONTH", "QUARTER", "YEAR"] as const;
export type BillingPeriod = (typeof BILLING_PERIODS)[number];

export function isBillingPeriod(value: unknown): value is BillingPeriod {
  return typeof value === "string" && (BILLING_PERIODS as readonly string[]).includes(value);
}

/** Сколько месяцев в периоде. Дни намеренно не используются: «30 дней» и
 *  «месяц» — разные вещи, и счёт должен приходить в то же число. */
export const PERIOD_MONTHS: Record<BillingPeriod, number> = {
  MONTH: 1,
  QUARTER: 3,
  YEAR: 12,
};

export function periodLabel(period: BillingPeriod): string {
  switch (period) {
    case "QUARTER":
      return "квартал";
    case "YEAR":
      return "год";
    default:
      return "месяц";
  }
}

/** «12 000 ₽ в месяц» — именно эта часть после суммы. */
export function periodAdverb(period: BillingPeriod): string {
  switch (period) {
    case "QUARTER":
      return "в квартал";
    case "YEAR":
      return "в год";
    default:
      return "в месяц";
  }
}

/* ── Арифметика сроков ─────────────────────────────────────── */

/**
 * Прибавить к дате расчётный период.
 *
 * День прижимается к последнему числу месяца: 31 января + 1 месяц даёт
 * 28 (или 29) февраля, а не 3 марта, как получилось бы при наивном setMonth.
 * Счёт, уезжающий вперёд на день-два каждый месяц, через год съездит на
 * неделю — и споры о «какой же у нас день платежа» обеспечены.
 */
export function addPeriod(from: Date, period: BillingPeriod, count = 1): Date {
  const months = PERIOD_MONTHS[period] * count;
  const day = from.getUTCDate();
  const next = new Date(Date.UTC(
    from.getUTCFullYear(),
    from.getUTCMonth() + months,
    1,
    from.getUTCHours(),
    from.getUTCMinutes(),
    from.getUTCSeconds(),
    from.getUTCMilliseconds(),
  ));
  const lastDay = new Date(Date.UTC(next.getUTCFullYear(), next.getUTCMonth() + 1, 0)).getUTCDate();
  next.setUTCDate(Math.min(day, lastDay));
  return next;
}

/* ── Состояние счёта ─────────────────────────────────────── */

/**
 * То и только то, что влияет на решения. Ни названий, ни документов, ни id:
 * состояние машины не должно зависеть от того, что написано в названии счёта.
 */
export interface PaymentFlowState {
  status: PaymentStatus;
  mode: PaymentMode;
  /** Заполнен только для подписки. */
  period: BillingPeriod | null;
  /** Ограниченное число списаний; null — бессрочно, до отмены. */
  cycles: number | null;
  /** Сколько периодов уже оплачено и подтверждено. */
  paidCycles: number;
  /** Когда наступает следующий платёж. */
  nextDueAt: Date | null;
}

export function isSubscription(state: Pick<PaymentFlowState, "mode">): boolean {
  return state.mode === "SUBSCRIPTION";
}

/** Все списания прошли — подписка закрыта и больше не продлевается. */
export function isSubscriptionComplete(state: PaymentFlowState): boolean {
  if (!isSubscription(state)) return false;
  return state.cycles !== null && state.paidCycles >= state.cycles;
}

/** Наступил ли срок очередного платежа. */
export function isCycleDue(state: PaymentFlowState, now: Date): boolean {
  if (!isSubscription(state) || isSubscriptionComplete(state)) return false;
  if (state.status !== "PAID") return false;
  return state.nextDueAt !== null && state.nextDueAt.getTime() <= now.getTime();
}

/**
 * Перевести оплаченную подписку в состояние «пора платить снова».
 *
 * Функция вызывается на чтении — без планировщика и фоновых задач. Отдельный
 * cron для такого перехода был бы ещё одним местом, которое может не запуститься,
 * а счёт всё равно смотрят глазами: состояние считается тогда, когда он нужен.
 */
export function applyDueTransition(state: PaymentFlowState, now: Date): PaymentFlowState {
  if (!isCycleDue(state, now)) return state;
  /* Именно SIGNED, а не UNPAID: бумаги подписаны один раз на всю подписку. */
  return { ...state, status: "SIGNED" };
}

/* ── Действия ─────────────────────────────────────────────── */

/**
 * `sign` и `declare` доступны только заказчику, `confirm` и `revoke` — только
 * администрации. Разграничение прав — забота маршрутов; здесь только то,
 * допустим ли шаг по самому состоянию счёта.
 */
export type FlowAction = "sign" | "declare" | "confirm" | "revoke";

export function canSign(state: PaymentFlowState): boolean {
  return state.status === "UNPAID";
}

export function canDeclare(state: PaymentFlowState): boolean {
  return state.status === "SIGNED";
}

export function canConfirm(state: PaymentFlowState): boolean {
  /* Подтвердить можно и без заявления клиента: деньги часто приходят на счёт
     раньше, чем клиент вспоминает про кнопку. Нельзя лишь подтверждать дважды. */
  return state.status !== "PAID";
}

export interface FlowResult {
  ok: boolean;
  state: PaymentFlowState;
  /** Причина отказа — готовый текст для ответа маршрута. */
  error?: string;
}

/**
 * Главная функция модуля: один шаг счёта.
 *
 * Возвращает НОВОЕ состояние, не меняя входное: так маршрут может сравнить
 * «было → стало» для журнала действий без второй копии старых значений.
 */
export function applyAction(state: PaymentFlowState, action: FlowAction, now: Date): FlowResult {
  /* Перед любым действием учитываем наступивший срок: иначе клиент с просроченной
     подпиской не смог бы заявить об оплате: формально у него стоит PAID. */
  const current = applyDueTransition(state, now);

  switch (action) {
    case "sign": {
      if (!canSign(current)) {
        return { ok: false, state: current, error: "Документы уже подписаны" };
      }
      return { ok: true, state: { ...current, status: "SIGNED" } };
    }

    case "declare": {
      if (!canDeclare(current)) {
        return {
          ok: false,
          state: current,
          error:
            current.status === "UNPAID"
              ? "Сначала нужно ознакомиться с документами и подписать их"
              : current.status === "AWAITING"
                ? "Оплата уже на проверке"
                : "Счёт уже оплачен",
        };
      }
      return { ok: true, state: { ...current, status: "AWAITING" } };
    }

    case "confirm": {
      if (!canConfirm(current)) {
        return { ok: false, state: current, error: "Поступление уже подтверждено" };
      }
      if (!isSubscription(current)) {
        return { ok: true, state: { ...current, status: "PAID", paidCycles: 1, nextDueAt: null } };
      }
      if (isSubscriptionComplete(current)) {
        return { ok: false, state: current, error: "Подписка уже завершена" };
      }
      const paidCycles = current.paidCycles + 1;
      const complete = current.cycles !== null && paidCycles >= current.cycles;
      /* Следующий срок считается от ПРЕДЫДУЩЕГО срока, а не от даты подтверждения:
         иначе каждая задержка клиента или администратора сдвигала бы всю сетку
         платежей вправо, и годовая подписка тихо превратилась бы в 11 платежей. */
      const base = current.nextDueAt ?? now;
      const period = current.period ?? "MONTH";
      return {
        ok: true,
        state: {
          ...current,
          status: "PAID",
          paidCycles,
          nextDueAt: complete ? null : addPeriod(base, period),
        },
      };
    }

    case "revoke": {
      /* Откат ошибки администратора: поступление подтвердили зря. Подпись при этом
         СОХРАНЯЕТСЯ: клиент документы видел и подписал, ошибся не он. */
      const paidCycles = Math.max(0, current.paidCycles - 1);
      return {
        ok: true,
        state: {
          ...current,
          status: "SIGNED",
          paidCycles,
          nextDueAt: isSubscription(current) ? current.nextDueAt : null,
        },
      };
    }

    default: {
      return { ok: false, state: current, error: "Неизвестное действие" };
    }
  }
}

/**
 * Первый срок платежа для только что выставленного счёта.
 *
 * Для подписки первый платёж — сразу (сегодня), а не через период: подписка
 * начинается с оплаты, а не с месяца бесплатной работы.
 */
export function initialNextDueAt(mode: PaymentMode, now: Date): Date | null {
  return mode === "SUBSCRIPTION" ? now : null;
}

/** Полная стоимость обязательства в копейках; null — бессрочная подписка. */
export function totalCommitment(amount: number, state: PaymentFlowState): number | null {
  if (!isSubscription(state)) return amount;
  if (state.cycles === null) return null;
  return amount * state.cycles;
}

/** Сколько списаний осталось; null — бессрочно. */
export function cyclesLeft(state: PaymentFlowState): number | null {
  if (!isSubscription(state) || state.cycles === null) return null;
  return Math.max(0, state.cycles - state.paidCycles);
}

/** Дата для интерфейса: «12 сентября 2026». */
export function formatDueDate(date: Date | string | null): string {
  if (!date) return "—";
  const value = typeof date === "string" ? new Date(date) : date;
  if (Number.isNaN(value.getTime())) return "—";
  return value.toLocaleDateString("ru-RU", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Строка-описание условий для шапки формы оплаты. Форматирование суммы передаётся
 * снаружи, чтобы модуль остался без зависимостей от Intl-локалей валюты.
 */
export function describeTerms(
  state: PaymentFlowState,
  formattedAmount: string,
): string {
  if (!isSubscription(state)) return `${formattedAmount} единым платежом`;
  const period = state.period ?? "MONTH";
  const tail =
    state.cycles === null
      ? "без ограничения срока"
      : `${state.cycles} платежей по ${periodLabel(period)}`;
  return `${formattedAmount} ${periodAdverb(period)} · ${tail}`;
}

/** Заглушка-проверка целостности: статусы модуля и базы не должны разойтись. */
export const KNOWN_STATUSES: readonly PaymentStatus[] = PAYMENT_STATUSES;
