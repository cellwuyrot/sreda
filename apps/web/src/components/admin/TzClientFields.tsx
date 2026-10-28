"use client";
import { useId } from "react";
export type ClientDraft = { name: string; uris: string; publicClient: boolean; offlineAccess: boolean; apiScopes: string[] };
export const clientInputClass = "w-full min-h-[44px] rounded-lg border border-neutral-500 dark:border-white/40 bg-transparent px-3 py-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";
export const permissionLabels: Record<string, string> = {
  "services:manage": "Общий каталог услуг и администраторы своего проекта",
  "services:fulfill": "Выдавать оплаченный доступ к услугам своего проекта (серверная интеграция)",
  "roles:read": "Проверять права администратора своего проекта",
  "contact:read": "Получать контактный адрес пользователя",
  "subscriptions:read": "Показывать подписки пользователя",
  "subscriptions:write": "Обновлять подписки своего проекта",
  "notifications:write": "Отправлять уведомления от своего проекта",
};
export function draftPayload(draft: ClientDraft) {
  return { name: draft.name, redirectUris: draft.uris.split("\n").map(s => s.trim()).filter(Boolean), offlineAccess: draft.offlineAccess,
    apiScopes: draft.apiScopes.filter(s => !draft.publicClient || !(s.endsWith(":write") || s.startsWith("services:") || s === "roles:read")) };
}
export default function TzClientFields({ value, onChange, creating = false, disabled = false }: { value: ClientDraft; onChange: (d: ClientDraft) => void; creating?: boolean; disabled?: boolean }) {
  const id = useId();
  return <fieldset disabled={disabled} className="space-y-4 min-w-0">
    <div><label htmlFor={`${id}-name`} className="block font-medium mb-1">Название приложения</label><input id={`${id}-name`} className={clientInputClass} required maxLength={100} value={value.name} onChange={e => onChange({ ...value, name: e.target.value })}/></div>
    <div><label htmlFor={`${id}-uris`} className="block font-medium mb-1">Куда возвращать пользователя после входа</label><p id={`${id}-help`} className="text-sm text-neutral-600 dark:text-neutral-300 mb-2">Точные HTTPS-адреса, каждый с новой строки. Их можно получить у разработчика приложения.</p><textarea id={`${id}-uris`} aria-describedby={`${id}-help`} className={clientInputClass} required rows={3} value={value.uris} onChange={e => onChange({ ...value, uris: e.target.value })}/></div>
    {creating ? <div><label htmlFor={`${id}-kind`} className="block font-medium mb-1">Тип приложения</label><select id={`${id}-kind`} className={clientInputClass} value={value.publicClient ? "public" : "server"} onChange={e => onChange({ ...value, publicClient: e.target.value === "public" })}><option value="server">Сайт с сервером — например, Business</option><option value="public">Мобильное приложение или сайт без сервера</option></select><p className="text-sm mt-1 text-neutral-600 dark:text-neutral-300">Тип нельзя поменять после создания: от него зависит способ защиты входа.</p></div> : <p className="text-sm text-neutral-600 dark:text-neutral-300">Тип: {value.publicClient ? "мобильное приложение / без сервера" : "сайт с сервером"}. Идентификатор и секрет при сохранении не меняются.</p>}
    <div className="rounded-lg bg-blue-50 dark:bg-blue-950/40 p-4"><label className="flex gap-3 items-start"><input type="checkbox" className="mt-1 h-5 w-5 shrink-0" checked={value.offlineAccess} onChange={e => onChange({ ...value, offlineAccess: e.target.checked })}/><span><strong className="block">Продлевать вход без повторной авторизации</strong><span className="block text-sm mt-1">Приложение сможет безопасно обновлять доступ. Пользователь даёт согласие при входе. Выход и отзыв доступа продолжают действовать.</span></span></label></div>
    <fieldset className="space-y-2"><legend className="font-medium mb-2">Что разрешено приложению</legend><p className="text-sm text-neutral-600 dark:text-neutral-300">Имя и email доступны с согласия пользователя. Дополнительные возможности выбирайте только при необходимости.</p>{Object.entries(permissionLabels).map(([scope, label]) => { const unavailable = value.publicClient && (scope.endsWith(":write") || scope.startsWith("services:") || scope === "roles:read"); return <label key={scope} className={`flex gap-3 items-center min-h-[44px] ${unavailable ? "opacity-60" : ""}`}><input type="checkbox" className="h-5 w-5 shrink-0" disabled={unavailable} checked={!unavailable && value.apiScopes.includes(scope)} onChange={e => onChange({ ...value, apiScopes: e.target.checked ? [...value.apiScopes, scope] : value.apiScopes.filter(s => s !== scope) })}/><span>{label}{unavailable && <span className="block text-sm">Только для сайта с сервером</span>}</span></label>; })}</fieldset>
  </fieldset>;
}
