import { describe, expect, it } from "vitest";
import {
  addPeriod,
  applyAction,
  applyDueTransition,
  cyclesLeft,
  describeTerms,
  initialNextDueAt,
  isCycleDue,
  isSubscriptionComplete,
  periodLabel,
  totalCommitment,
  type PaymentFlowState,
} from "./businessPaymentFlow";

/**
 * BUSINESS-SUB: тесты логики оплаты бизнес-счёта.
 *
 * Модуль сознательно сделан чистым и не знает ни о Prisma, ни о запросах:
 * именно поэтому всю цепочку «подписал → заявил об оплате → админ подтвердил
 * → продление» можно прогнать без базы и без сети.
 */

const T0 = new Date("2026-01-31T10:00:00.000Z");

function oneTime(): PaymentFlowState {
  return {
    status: "UNPAID",
    mode: "ONE_TIME",
    period: null,
    cycles: null,
    paidCycles: 0,
    nextDueAt: initialNextDueAt("ONE_TIME", T0),
  };
}

function subscription(period: "MONTH" | "QUARTER" | "YEAR", cycles: number | null): PaymentFlowState {
  return {
    status: "UNPAID",
    mode: "SUBSCRIPTION",
    period,
    cycles,
    paidCycles: 0,
    nextDueAt: initialNextDueAt("SUBSCRIPTION", T0),
  };
}

describe("разовый счёт", () => {
  it("не позволяет заявить об оплате до подписи", () => {
    const res = applyAction(oneTime(), "declare", T0);
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
  });

  it("проходит цепочку UNPAID → SIGNED → AWAITING → PAID", () => {
    let s = oneTime();
    s = applyAction(s, "sign", T0).state;
    expect(s.status).toBe("SIGNED");
    s = applyAction(s, "declare", T0).state;
    expect(s.status).toBe("AWAITING");
    s = applyAction(s, "confirm", T0).state;
    expect(s.status).toBe("PAID");
    expect(s.paidCycles).toBe(1);
    /* У разового счёта следующего срока не бывает. */
    expect(s.nextDueAt).toBeNull();
  });

  it("отклоняет повторное подтверждение и умеет откатывать", () => {
    let s = oneTime();
    s = applyAction(s, "sign", T0).state;
    s = applyAction(s, "declare", T0).state;
    s = applyAction(s, "confirm", T0).state;
    expect(applyAction(s, "confirm", T0).ok).toBe(false);
    const back = applyAction(s, "revoke", T0);
    expect(back.ok).toBe(true);
    expect(back.state.status).toBe("SIGNED");
  });

  it("никогда не требует продления", () => {
    let s = oneTime();
    s = applyAction(s, "sign", T0).state;
    s = applyAction(s, "declare", T0).state;
    s = applyAction(s, "confirm", T0).state;
    expect(isCycleDue(s, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });
});

describe("арифметика периодов", () => {
  it("зажимает дату до конца короткого месяца", () => {
    expect(addPeriod(new Date("2026-01-31T10:00:00Z"), "MONTH").toISOString().slice(0, 10)).toBe("2026-02-28");
    expect(addPeriod(new Date("2028-01-31T10:00:00Z"), "MONTH").toISOString().slice(0, 10)).toBe("2028-02-29");
  });

  it("считает квартал и год", () => {
    expect(addPeriod(new Date("2026-03-15T00:00:00Z"), "QUARTER").toISOString().slice(0, 10)).toBe("2026-06-15");
    expect(addPeriod(new Date("2026-03-15T00:00:00Z"), "YEAR").toISOString().slice(0, 10)).toBe("2027-03-15");
  });

  it("даёт читаемые названия периодов", () => {
    expect(periodLabel("MONTH")).toBe("месяц");
    expect(periodLabel("QUARTER")).toBe("квартал");
    expect(periodLabel("YEAR")).toBe("год");
  });
});

describe("подписка", () => {
  it("ставит срок следующего платежа после первого подтверждения", () => {
    let s = subscription("MONTH", 3);
    s = applyAction(s, "sign", T0).state;
    s = applyAction(s, "declare", T0).state;
    s = applyAction(s, "confirm", T0).state;
    expect(s.status).toBe("PAID");
    expect(s.paidCycles).toBe(1);
    expect(s.nextDueAt?.toISOString().slice(0, 10)).toBe("2026-02-28");
  });

  it("в день срока возвращает статус к «к оплате», а не к «не оплачено»", () => {
    let s = subscription("MONTH", 3);
    s = applyAction(s, "sign", T0).state;
    s = applyAction(s, "declare", T0).state;
    s = applyAction(s, "confirm", T0).state;

    const due = new Date("2026-02-28T10:00:01Z");
    expect(isCycleDue(s, due)).toBe(true);
    const shifted = applyDueTransition(s, due);
    /* Подпись клиента не аннулируется: документы подписаны один раз. */
    expect(shifted.status).toBe("SIGNED");
    expect(shifted.paidCycles).toBe(1);
  });

  it("закрывается после последнего периода", () => {
    let s = subscription("MONTH", 2);
    s = applyAction(s, "sign", T0).state;
    s = applyAction(s, "declare", T0).state;
    s = applyAction(s, "confirm", T0).state;
    expect(cyclesLeft(s)).toBe(1);

    const due = s.nextDueAt as Date;
    s = applyDueTransition(s, due);
    s = applyAction(s, "declare", due).state;
    s = applyAction(s, "confirm", due).state;

    expect(s.paidCycles).toBe(2);
    expect(s.nextDueAt).toBeNull();
    expect(isSubscriptionComplete(s)).toBe(true);
    expect(applyAction(s, "confirm", due).ok).toBe(false);
    expect(isCycleDue(s, new Date("2030-01-01T00:00:00Z"))).toBe(false);
  });

  it("бессрочная подписка продлевается бесконечно", () => {
    let s = subscription("QUARTER", null);
    s = applyAction(s, "sign", T0).state;
    for (let i = 0; i < 4; i++) {
      const at = s.nextDueAt ?? T0;
      s = applyDueTransition(s, at);
      s = applyAction(s, "declare", at).state;
      s = applyAction(s, "confirm", at).state;
    }
    expect(s.paidCycles).toBe(4);
    expect(s.nextDueAt).not.toBeNull();
    expect(isSubscriptionComplete(s)).toBe(false);
    expect(s.nextDueAt?.toISOString().slice(0, 7)).toBe("2027-01");
  });

  it("считает общую сумму только для конечной подписки", () => {
    expect(totalCommitment(15000, subscription("MONTH", 3))).toBe(45000);
    expect(totalCommitment(15000, subscription("MONTH", null))).toBeNull();
  });

  it("описывает условия человеческим языком", () => {
    const text = describeTerms(subscription("MONTH", 3), "15 000 ₽");
    expect(text).toContain("15 000 ₽");
    expect(text.length).toBeGreaterThan(5);
  });
});
