"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import Spinner from "@/components/ui/Spinner";
import {
  formatAmount,
  formatSize,
  isPaid,
  isSigned,
  statusLabel,
  /* BUSINESS-SUB: счёт бывает разовым или подпиской — тексты условий считает общий модуль. */
  MAX_DOCUMENT_SIZE,
  type BusinessContractView,
  type BusinessPaymentView,
} from "@/lib/businessPayment";
import { describeTerms, formatDueDate } from "@/lib/businessPaymentFlow";

/**
 * BUSINESS-PAY: окно оплаты за кнопкой «Оплачено / Не оплачено» в шапке делового чата.
 *
 * Порядок шагов жёсткий и одинаковый для всех:
 *
 *   Не оплачено → ознакомление с документами и подпись → оплата по реквизитам
 *   → «Я оплатил» → проверка администрацией → Оплачено → подписанные договоры.
 *
 * Кнопка «Оплатить» не появляется, пока документы не подписаны: в этом весь
 * смысл требования «ознакомиться прежде, чем подписать и заплатить».
 *
 * Статус «Оплачено» ставит только администрация и только из своего раздела.
 * «Я оплатил» — это заявление клиента, а не факт поступления денег.
 */

interface Props {
  conversationId: string;
  onClose: () => void;
  /** Чтобы плашка в шапке обновилась без перезагрузки всей панели. */
  onChanged?: (payment: BusinessPaymentView | null) => void;
}

function DocRow({ name, url, size, hint }: { name: string; url: string; size?: number; hint?: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer"
      className="flex items-center gap-3 p-2.5 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-card)] hover:bg-[var(--cn-hover)] transition-colors"
    >
      <svg className="w-5 h-5 flex-shrink-0 text-neutral-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 3h7l5 5v13a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1Z" />
        <path strokeLinecap="round" strokeWidth={2} d="M14 3v5h5" />
      </svg>
      <span className="min-w-0 flex-1">
        <span className="block text-sm text-neutral-900 dark:text-white truncate">{name}</span>
        <span className="block text-[11px] text-neutral-400">
          {hint ?? (size ? formatSize(size) : "Документ")}
        </span>
      </span>
      <span className="text-[11px] text-violet-500 dark:text-cyan-400 flex-shrink-0">Открыть</span>
    </a>
  );
}

export default function BusinessPaymentModal({ conversationId, onClose, onChanged }: Props) {
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [payment, setPayment] = useState<BusinessPaymentView | null>(null);
  const [party, setParty] = useState<"client" | "staff">("client");

  /* Флажок ознакомления и имя живут только в окне: на сервер уходит уже
     результат — подпись. Хранить полушаг «галочка стоит, но не подписал» нечего. */
  const [agreed, setAgreed] = useState(false);
  const [signName, setSignName] = useState("");
  const [note, setNote] = useState("");

  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/business/${conversationId}/payment`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить счёт");
      setPayment(data.payment ?? null);
      setParty(data.party === "staff" ? "staff" : "client");
      onChanged?.(data.payment ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setLoading(false);
    }
  }, [conversationId, onChanged]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Esc закрывает окно. Окно без выхода по Esc — та же боль, что незакрываемая
     панель отложенной отправки, которую чинили раньше. */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  async function act(action: "sign" | "declare") {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/business/${conversationId}/payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, name: signName, note }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось выполнить действие");
      setPayment(data.payment ?? null);
      onChanged?.(data.payment ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function uploadContract(file: File) {
    if (file.size > MAX_DOCUMENT_SIZE) {
      setError(`Файл слишком большой (макс. ${formatSize(MAX_DOCUMENT_SIZE)})`);
      return;
    }
    setBusy(true);
    setError("");
    try {
      const fd = new FormData();
      fd.append("file", file);
      const up = await fetch("/api/upload/document", { method: "POST", body: fd });
      const upData = await up.json();
      if (!up.ok) throw new Error(upData?.error || "Не удалось загрузить файл");

      const res = await fetch(`/api/business/${conversationId}/contracts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(upData),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось прикрепить договор");
      setPayment((p) => (p ? { ...p, contracts: data.contracts as BusinessContractView[] } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка загрузки");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeContract(contractId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/business/${conversationId}/contracts?contractId=${contractId}`, {
        method: "DELETE",
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось убрать документ");
      setPayment((p) => (p ? { ...p, contracts: data.contracts as BusinessContractView[] } : p));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  const paid = !!payment && isPaid(payment.status);
  const signed = !!payment && isSigned(payment.status);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onClick={onClose}
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 backdrop-blur-sm p-4"
    >
      <motion.div
        initial={{ scale: 0.96, y: 12 }}
        animate={{ scale: 1, y: 0 }}
        exit={{ scale: 0.96, y: 12 }}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-lg max-h-[85vh] overflow-y-auto rounded-2xl border border-[var(--cn-border)] bg-[var(--cn-sidebar)] p-5"
      >
        <div className="flex items-start gap-3 mb-4">
          <div className="min-w-0 flex-1">
            <h3 className="text-lg font-semibold text-neutral-900 dark:text-white">Оплата услуги</h3>
            <p className="text-[12px] text-neutral-400">
              {payment ? statusLabel(payment.status) : "Счёт ещё не выставлен"}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="w-9 h-9 rounded-xl border border-[var(--cn-border)] inline-flex items-center justify-center text-neutral-400 hover:text-neutral-800 dark:hover:text-white hover:bg-[var(--cn-hover)]"
          >
            ✕
          </button>
        </div>

        {loading ? (
          <div className="py-10 flex justify-center"><Spinner /></div>
        ) : !payment ? (
          <p className="text-sm text-neutral-400 py-6 text-center">
            {party === "staff"
              ? "Счёт по этому обращению ещё не выставлен. Создайте форму оплаты в разделе «Пользователи → Бизнес»."
              : "Администрация ещё не подготовила счёт. Как только он появится, вы получите уведомление."}
          </p>
        ) : (
          <div className="space-y-4">
            {/* ── Суть счёта ── */}
            <div className="p-3 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-card)]">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-sm font-medium text-neutral-900 dark:text-white">{payment.title}</span>
                <span className="text-lg font-semibold text-neutral-900 dark:text-white whitespace-nowrap">
                  {formatAmount(payment.amount, payment.currency)}
                </span>
              </div>
              {payment.serviceTitle && (
                <p className="text-[11px] text-neutral-400 mt-1">Услуга: {payment.serviceTitle}</p>
              )}
              {/* BUSINESS-SUB: у подписки цифра выше — цена одного периода, а не всего
                  договора, и об этом надо сказать прямо рядом с суммой. */}
              {payment.mode === "SUBSCRIPTION" && (
                <p className="text-[11px] text-violet-500 dark:text-cyan-300 mt-1">
                  {describeTerms(
                    {
                      status: payment.status,
                      mode: payment.mode,
                      period: payment.period,
                      cycles: payment.cycles,
                      paidCycles: payment.paidCycles,
                      nextDueAt: payment.nextDueAt ? new Date(payment.nextDueAt) : null,
                    },
                    formatAmount(payment.amount, payment.currency),
                  )}
                  {payment.nextDueAt
                    ? ` · следующий платёж: ${formatDueDate(new Date(payment.nextDueAt))}`
                    : " · платежей больше нет"}
                  {payment.paidCycles > 0 ? ` · оплачено периодов: ${payment.paidCycles}` : ""}
                </p>
              )}
              {payment.dueNow && (
                <p className="text-[12px] text-amber-500 mt-2">
                  Подошёл срок продления подписки — оплатите следующий период.
                  Подписывать документы заново не нужно.
                </p>
              )}
              {payment.description && (
                <p className="text-[13px] text-neutral-500 dark:text-neutral-300 mt-2 whitespace-pre-wrap">
                  {payment.description}
                </p>
              )}
            </div>

            {/* ── Документы к ознакомлению ── */}
            {payment.documents.length > 0 && (
              <div>
                <p className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-2">
                  Документы к ознакомлению
                </p>
                <div className="space-y-2">
                  {payment.documents.map((d) => (
                    <DocRow key={d.id} name={d.name} url={d.url} size={d.size} />
                  ))}
                </div>
              </div>
            )}

            {/* ── Шаг 1: подпись ── */}
            {party === "client" && !signed && (
              <div className="p-3 rounded-xl border border-[var(--cn-border)] space-y-3">
                <label className="flex items-start gap-2 text-[13px] text-neutral-600 dark:text-neutral-300">
                  <input
                    type="checkbox"
                    checked={agreed}
                    onChange={(e) => setAgreed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>Я ознакомился с документами и соглашаюсь с условиями</span>
                </label>
                <input
                  value={signName}
                  onChange={(e) => setSignName(e.target.value)}
                  placeholder="ФИО или название организации"
                  className="w-full px-3 py-2 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-card)] text-sm text-neutral-900 dark:text-white outline-none focus:border-violet-400 dark:focus:border-cyan-400"
                />
                <button
                  type="button"
                  disabled={!agreed || signName.trim().length < 3 || busy}
                  onClick={() => act("sign")}
                  className="w-full py-2.5 rounded-xl bg-violet-600 dark:bg-cyan-600 text-white text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed"
                >
                  Подписать и перейти к оплате
                </button>
              </div>
            )}

            {/* ── Шаг 2: реквизиты и заявление об оплате ── */}
            {signed && !paid && (
              <div className="p-3 rounded-xl border border-[var(--cn-border)] space-y-3">
                {payment.signedName && (
                  <p className="text-[11px] text-neutral-400">
                    Подписано: {payment.signedName}
                  </p>
                )}
                {payment.requisites ? (
                  <div>
                    <p className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400 mb-1">
                      Реквизиты для оплаты
                    </p>
                    <pre className="text-[12px] whitespace-pre-wrap text-neutral-700 dark:text-neutral-200 font-sans">
                      {payment.requisites}
                    </pre>
                  </div>
                ) : (
                  <p className="text-[12px] text-neutral-400">
                    Реквизиты пришлёт администрация в этом же разговоре.
                  </p>
                )}

                {party === "client" && payment.status !== "AWAITING" && (
                  <>
                    <input
                      value={note}
                      onChange={(e) => setNote(e.target.value)}
                      placeholder="Номер платёжа или комментарий (необязательно)"
                      className="w-full px-3 py-2 rounded-xl border border-[var(--cn-border)] bg-[var(--cn-card)] text-sm text-neutral-900 dark:text-white outline-none"
                    />
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() => act("declare")}
                      className="w-full py-2.5 rounded-xl bg-green-600 text-white text-sm font-medium disabled:opacity-40"
                    >
                      {payment.mode === "SUBSCRIPTION" && payment.paidCycles > 0
                        ? "Я продлил подписку"
                        : "Я оплатил"}
                    </button>
                  </>
                )}

                {payment.status === "AWAITING" && (
                  <p className="text-[12px] text-amber-500">
                    Оплата на проверке у администрации. Как только поступление подтвердят,
                    здесь откроется раздел подписанных договоров.
                  </p>
                )}
              </div>
            )}

            {/* ── Шаг 3: подписанные договоры ── */}
            {paid && (
              <div>
                <div className="flex items-center justify-between gap-3 mb-2">
                  <p className="text-[12px] font-medium text-neutral-500 dark:text-neutral-400">
                    Подписанные договоры
                  </p>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => fileRef.current?.click()}
                    className="text-[12px] px-3 py-1.5 rounded-lg bg-violet-500/15 dark:bg-cyan-500/15 text-violet-600 dark:text-cyan-300 disabled:opacity-40"
                  >
                    Добавить
                  </button>
                  <input
                    ref={fileRef}
                    type="file"
                    hidden
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void uploadContract(f);
                    }}
                  />
                </div>
                {payment.contracts.length === 0 ? (
                  <p className="text-[12px] text-neutral-400">
                    Пока пусто. Подписанный экземпляр может добавить любая из сторон.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {payment.contracts.map((c) => (
                      <div key={c.id} className="flex items-center gap-2">
                        <div className="min-w-0 flex-1">
                          <DocRow
                            name={c.name}
                            url={c.url}
                            hint={`${c.uploadedByName ?? "Участник"} · ${formatSize(c.size)}`}
                          />
                        </div>
                        {c.mine && (
                          <button
                            type="button"
                            disabled={busy}
                            onClick={() => removeContract(c.id)}
                            title="Убрать"
                            aria-label={`Убрать ${c.name}`}
                            className="w-9 h-9 rounded-xl border border-[var(--cn-border)] text-neutral-400 hover:text-red-400 flex-shrink-0"
                          >
                            ✕
                          </button>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {error && <p className="mt-3 text-[12px] text-red-400">{error}</p>}
      </motion.div>
    </motion.div>
  );
}
