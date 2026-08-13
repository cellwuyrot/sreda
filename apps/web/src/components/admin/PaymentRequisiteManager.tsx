"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Spinner from "@/components/ui/Spinner";
import Button from "@/components/ui/Button";
import { confirmDialog } from "@/components/ui/ConfirmDialog";

/**
 * PAY-TEMPLATE: шаблоны платёжных реквизитов в разделе «Платежи».
 *
 * ── Зачем ──────────────────────────────────────────────────────────
 *
 * Раньше раздел был ОДНОЙ формой на один набор реквизитов: пока счета
 * выставляет один человек от одного юрлица, этого достаточно. Когда
 * администраторов несколько, набор перестаёт быть одним — и реквизиты начинают
 * дописывать в счёт руками каждый раз. Здесь именованные шаблоны: личные
 * (видит только владелец) и общие проекта, с признаком «по умолчанию».
 *
 * Готовый текст считает СЕРВЕР (поле preview): администратор должен видеть ровно
 * то, что попадёт в счёт клиенту, а не браузерную копию той же сборки.
 */

const inputClass =
  "w-full px-3 py-2 rounded-xl text-sm bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-900 dark:text-white placeholder:text-neutral-400 focus:outline-none focus:ring-2 focus:ring-violet-500/30";
const labelClass = "block text-xs font-medium text-neutral-600 dark:text-neutral-400 mb-1";
const cardClass =
  "bg-white dark:bg-neutral-800/50 rounded-2xl border border-neutral-200 dark:border-white/10 p-5";

export interface Requisite {
  id: string;
  name: string;
  scope: string;
  shared: boolean;
  mine: boolean;
  ownerName: string | null;
  isDefault: boolean;
  orgName: string;
  inn: string;
  kpp: string;
  bank: string;
  bik: string;
  account: string;
  corrAccount: string;
  purpose: string;
  sbpEnabled: boolean;
  sbpPhone: string;
  sbpBank: string;
  sbpRecipient: string;
  acquiringEnabled: boolean;
  acquiringProvider: string;
  acquiringLink: string;
  acquiringMerchant: string;
  comment: string;
  bodyOverride: string;
  mode: string;
  period: string | null;
  usedCount: number;
  lastUsedAt: string | null;
  createdByName: string;
  updatedAt: string;
  preview: string;
}

type Draft = Omit<Requisite, "id" | "mine" | "ownerName" | "usedCount" | "lastUsedAt" | "createdByName" | "updatedAt" | "preview"> & {
  id: string | null;
};

const EMPTY_DRAFT: Draft = {
  id: null,
  name: "",
  scope: "BUSINESS",
  shared: false,
  isDefault: false,
  orgName: "",
  inn: "",
  kpp: "",
  bank: "",
  bik: "",
  account: "",
  corrAccount: "",
  purpose: "",
  sbpEnabled: false,
  sbpPhone: "",
  sbpBank: "",
  sbpRecipient: "",
  acquiringEnabled: false,
  acquiringProvider: "",
  acquiringLink: "",
  acquiringMerchant: "",
  comment: "",
  bodyOverride: "",
  mode: "ONE_TIME",
  period: "MONTH",
};

function draftOf(row: Requisite): Draft {
  return {
    id: row.id,
    name: row.name,
    scope: row.scope,
    shared: row.shared,
    isDefault: row.isDefault,
    orgName: row.orgName,
    inn: row.inn,
    kpp: row.kpp,
    bank: row.bank,
    bik: row.bik,
    account: row.account,
    corrAccount: row.corrAccount,
    purpose: row.purpose,
    sbpEnabled: row.sbpEnabled,
    sbpPhone: row.sbpPhone,
    sbpBank: row.sbpBank,
    sbpRecipient: row.sbpRecipient,
    acquiringEnabled: row.acquiringEnabled,
    acquiringProvider: row.acquiringProvider,
    acquiringLink: row.acquiringLink,
    acquiringMerchant: row.acquiringMerchant,
    comment: row.comment,
    bodyOverride: row.bodyOverride,
    mode: row.mode,
    period: row.period ?? "MONTH",
  };
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  hint,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
}) {
  return (
    <div>
      <label className={labelClass}>{label}</label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={inputClass}
      />
      {hint && <p className="mt-1 text-[11px] text-neutral-400">{hint}</p>}
    </div>
  );
}

function Check({
  on,
  onToggle,
  label,
  hint,
}: {
  on: boolean;
  onToggle: () => void;
  label: string;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex items-start gap-2 text-left w-full"
    >
      <span
        className={`mt-0.5 w-5 h-5 shrink-0 rounded-md border flex items-center justify-center text-[11px] ${
          on
            ? "bg-violet-500 border-violet-500 text-white"
            : "border-neutral-300 dark:border-white/20 text-transparent"
        }`}
      >
        ✓
      </span>
      <span className="text-sm text-neutral-700 dark:text-neutral-300">
        {label}
        {hint && <span className="block text-[11px] text-neutral-400">{hint}</span>}
      </span>
    </button>
  );
}

export default function PaymentRequisiteManager() {
  const [items, setItems] = useState<Requisite[]>([]);
  const [settingsPreview, setSettingsPreview] = useState("");
  const [limit, setLimit] = useState(30);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [draft, setDraft] = useState<Draft | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/payment-requisites");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось загрузить шаблоны");
      setItems(data.requisites ?? []);
      setSettingsPreview(data.settingsPreview ?? "");
      setLimit(data.limit ?? 30);
      setError("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const mine = useMemo(() => items.filter((r) => !r.shared), [items]);
  const commonOnes = useMemo(() => items.filter((r) => r.shared), [items]);

  function patchDraft(patch: Partial<Draft>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function saveDraft() {
    if (!draft) return;
    if (!draft.name.trim()) {
      setError("Укажите название шаблона");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const url = draft.id
        ? `/api/admin/payment-requisites/${draft.id}`
        : "/api/admin/payment-requisites";
      const res = await fetch(url, {
        method: draft.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...draft,
          /* Период имеет смысл только у подписки. */
          period: draft.mode === "SUBSCRIPTION" ? draft.period : null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось сохранить");
      setDraft(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function createFromSettings() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/payment-requisites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fromSettings: true,
          name: "Реквизиты проекта",
          shared: true,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось создать");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function duplicate(row: Requisite) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch("/api/admin/payment-requisites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ copyFromId: row.id, shared: row.shared }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "Не удалось скопировать");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  async function makeDefault(row: Requisite) {
    setBusy(true);
    try {
      await fetch(`/api/admin/payment-requisites/${row.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isDefault: true }),
      });
      await load();
    } finally {
      setBusy(false);
    }
  }

  async function remove(row: Requisite) {
    /* Удаление шаблона не трогает выставленные счета: в них лежит снимок текста. */
    if (
      !(await confirmDialog({
        title: `Удалить шаблон «${row.name}»?`,
        message:
          "Уже выставленные счета не изменятся — в них сохранён текст реквизитов на момент выставления.",
        confirmText: "Удалить",
      }))
    ) {
      return;
    }
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/admin/payment-requisites/${row.id}`, { method: "DELETE" });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(data?.error || "Не удалось удалить");
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Ошибка");
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="flex justify-center py-10">
        <Spinner />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className={cardClass}>
        <h2 className="text-base font-semibold text-neutral-900 dark:text-white">
          Шаблоны реквизитов
        </h2>
        <p className="text-sm text-neutral-500 mt-1">
          Наборы, которые подставляются в счёт делового чата. Личные шаблоны видит
          только их владелец, общие — все администраторы. Шаблон по умолчанию
          подставляется сам: личный главнее общего.
        </p>
        <div className="flex flex-wrap gap-2 mt-4">
          <Button onClick={() => setDraft({ ...EMPTY_DRAFT })} disabled={busy} size="sm">
            Новый шаблон
          </Button>
          <button
            type="button"
            onClick={createFromSettings}
            disabled={busy}
            className="px-3 py-2 rounded-xl text-sm bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-300 hover:text-neutral-900 dark:hover:text-white disabled:opacity-40"
          >
            Создать из реквизитов проекта
          </button>
        </div>
        {items.length === 0 && settingsPreview && (
          <div className="mt-4 rounded-xl bg-neutral-50 dark:bg-white/5 border border-neutral-200 dark:border-white/10 p-3">
            <p className="text-[11px] text-neutral-500 mb-1">
              Пока шаблонов нет, в счёт подставляется этот текст из вкладки «Бизнес»:
            </p>
            <pre className="text-[11px] whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
              {settingsPreview}
            </pre>
          </div>
        )}
        {error && <p className="mt-3 text-sm text-red-500">{error}</p>}
      </div>

      {draft && (
        <div className={cardClass}>
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">
              {draft.id ? "Правка шаблона" : "Новый шаблон"}
            </h3>
            <button
              type="button"
              onClick={() => setDraft(null)}
              className="text-xs text-neutral-500 hover:text-neutral-900 dark:hover:text-white"
            >
              Закрыть
            </button>
          </div>

          <div className="space-y-4">
            <Field
              label="Название шаблона"
              value={draft.name}
              onChange={(v) => patchDraft({ name: v })}
              placeholder="Например: ИП Иванов — СБП"
            />

            <div className="grid sm:grid-cols-2 gap-3">
              <Check
                on={draft.shared}
                onToggle={() => patchDraft({ shared: !draft.shared })}
                label="Общий шаблон проекта"
                hint="Без галочки шаблон личный и виден только вам"
              />
              <Check
                on={draft.isDefault}
                onToggle={() => patchDraft({ isDefault: !draft.isDefault })}
                label="Подставлять по умолчанию"
                hint="Если в форме счёта шаблон не выбран"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <Field label="Получатель (организация или ИП)" value={draft.orgName} onChange={(v) => patchDraft({ orgName: v })} />
              <Field label="Назначение платежа" value={draft.purpose} onChange={(v) => patchDraft({ purpose: v })} />
              <Field label="ИНН" value={draft.inn} onChange={(v) => patchDraft({ inn: v })} hint="только цифры" />
              <Field label="КПП" value={draft.kpp} onChange={(v) => patchDraft({ kpp: v })} hint="у ИП нет" />
              <Field label="Банк" value={draft.bank} onChange={(v) => patchDraft({ bank: v })} />
              <Field label="БИК" value={draft.bik} onChange={(v) => patchDraft({ bik: v })} />
              <Field label="Расчётный счёт" value={draft.account} onChange={(v) => patchDraft({ account: v })} />
              <Field label="Корр. счёт" value={draft.corrAccount} onChange={(v) => patchDraft({ corrAccount: v })} />
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3 space-y-3">
              <Check
                on={draft.sbpEnabled}
                onToggle={() => patchDraft({ sbpEnabled: !draft.sbpEnabled })}
                label="СБП-перевод"
              />
              {draft.sbpEnabled && (
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Телефон" value={draft.sbpPhone} onChange={(v) => patchDraft({ sbpPhone: v })} />
                  <Field label="Банк" value={draft.sbpBank} onChange={(v) => patchDraft({ sbpBank: v })} />
                  <Field label="Получатель" value={draft.sbpRecipient} onChange={(v) => patchDraft({ sbpRecipient: v })} />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-neutral-200 dark:border-white/10 p-3 space-y-3">
              <Check
                on={draft.acquiringEnabled}
                onToggle={() => patchDraft({ acquiringEnabled: !draft.acquiringEnabled })}
                label="Интернет-эквайринг"
              />
              {draft.acquiringEnabled && (
                <div className="grid sm:grid-cols-3 gap-3">
                  <Field label="Провайдер" value={draft.acquiringProvider} onChange={(v) => patchDraft({ acquiringProvider: v })} />
                  <Field
                    label="Платёжная ссылка"
                    value={draft.acquiringLink}
                    onChange={(v) => patchDraft({ acquiringLink: v })}
                    hint="https://…"
                  />
                  <Field label="Идентификатор мерчанта" value={draft.acquiringMerchant} onChange={(v) => patchDraft({ acquiringMerchant: v })} />
                </div>
              )}
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className={labelClass}>Способ выставления по умолчанию</label>
                <select
                  value={draft.mode}
                  onChange={(e) => patchDraft({ mode: e.target.value })}
                  className={inputClass}
                >
                  <option value="ONE_TIME">Разовый счёт</option>
                  <option value="SUBSCRIPTION">Подписка</option>
                </select>
              </div>
              <div>
                <label className={labelClass}>Период</label>
                <select
                  value={draft.period ?? "MONTH"}
                  disabled={draft.mode !== "SUBSCRIPTION"}
                  onChange={(e) => patchDraft({ period: e.target.value })}
                  className={`${inputClass} disabled:opacity-40`}
                >
                  <option value="MONTH">Месяц</option>
                  <option value="QUARTER">Квартал</option>
                  <option value="YEAR">Год</option>
                </select>
              </div>
            </div>

            <div>
              <label className={labelClass}>Комментарий для клиента</label>
              <textarea
                value={draft.comment}
                onChange={(e) => patchDraft({ comment: e.target.value })}
                rows={2}
                className={`${inputClass} resize-none`}
              />
            </div>

            <div>
              <label className={labelClass}>Свой текст реквизитов (перекрывает поля выше)</label>
              <textarea
                value={draft.bodyOverride}
                onChange={(e) => patchDraft({ bodyOverride: e.target.value })}
                rows={4}
                placeholder="Заполняется, когда формулировку нельзя уложить в поля: агентский договор, НДС, ссылка на приложение…"
                className={`${inputClass} resize-none`}
              />
              <p className="mt-1 text-[11px] text-neutral-400">
                Если поле заполнено, в счёт идёт именно он — без сборки из полей.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <Button onClick={saveDraft} disabled={busy} size="sm">
                {busy ? "Сохранение…" : "Сохранить шаблон"}
              </Button>
              <button
                type="button"
                onClick={() => setDraft(null)}
                className="px-3 py-2 rounded-xl text-sm bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-600 dark:text-neutral-300"
              >
                Отмена
              </button>
            </div>
          </div>
        </div>
      )}

      {[
        { title: "Мои шаблоны", rows: mine },
        { title: "Общие шаблоны проекта", rows: commonOnes },
      ].map((group) => (
        <div key={group.title} className={cardClass}>
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-sm font-semibold text-neutral-900 dark:text-white">{group.title}</h3>
            <span className="text-[11px] text-neutral-400">
              {group.rows.length} из {limit}
            </span>
          </div>

          {group.rows.length === 0 ? (
            <p className="text-sm text-neutral-500">Пока пусто.</p>
          ) : (
            <div className="space-y-3">
              {group.rows.map((row) => (
                <div
                  key={row.id}
                  className="rounded-xl border border-neutral-200 dark:border-white/10 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-sm font-medium text-neutral-900 dark:text-white">
                      {row.name}
                    </span>
                    {row.isDefault && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-violet-500/15 text-violet-500">
                        по умолчанию
                      </span>
                    )}
                    {row.bodyOverride && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] bg-amber-500/15 text-amber-500">
                        свой текст
                      </span>
                    )}
                    <span className="text-[11px] text-neutral-400">
                      выставлено счетов: {row.usedCount}
                    </span>
                  </div>

                  <pre className="mt-2 text-[11px] whitespace-pre-wrap text-neutral-600 dark:text-neutral-300">
                    {row.preview || "Реквизиты не заполнены — в счёт попадёт пустота."}
                  </pre>

                  <div className="flex flex-wrap gap-2 mt-3">
                    <button
                      type="button"
                      onClick={() => setDraft(draftOf(row))}
                      className="px-3 py-1.5 rounded-lg text-xs bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200"
                    >
                      Редактировать
                    </button>
                    <button
                      type="button"
                      onClick={() => duplicate(row)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg text-xs bg-neutral-100 dark:bg-white/5 border border-neutral-200 dark:border-white/10 text-neutral-700 dark:text-neutral-200 disabled:opacity-40"
                    >
                      Дублировать
                    </button>
                    {!row.isDefault && (
                      <button
                        type="button"
                        onClick={() => makeDefault(row)}
                        disabled={busy}
                        className="px-3 py-1.5 rounded-lg text-xs bg-violet-500/10 border border-violet-500/30 text-violet-500 disabled:opacity-40"
                      >
                        Сделать основным
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => remove(row)}
                      disabled={busy}
                      className="px-3 py-1.5 rounded-lg text-xs bg-red-500/10 border border-red-500/30 text-red-500 disabled:opacity-40"
                    >
                      Удалить
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
