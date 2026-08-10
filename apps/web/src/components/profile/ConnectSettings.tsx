"use client";

/**
 * Обёртка над разделом «Настройки → TZ.Connect».
 *
 * Раньше пять независимых карточек (аккаунт, внешний вид чата, витрина,
 * серверный профиль, чёрный список) просто стояли в столбик — пользователь
 * прокручивал длинную страницу, чтобы найти нужную группу настроек. Здесь
 * они собраны по смыслу в три вкладки, а переключение вкладок не требует
 * захода в другой раздел настроек и не создаёт лишних сетевых запросов —
 * каждая карточка внутри вкладки как и раньше сама отвечает за свои данные.
 */

import { useState } from "react";
import { SettingsTabs } from "@/components/settings/SettingsUI";
import ConnectProfileSettings from "@/components/profile/ConnectProfileSettings";
import ChatAppearanceSettings from "@/components/profile/ChatAppearanceSettings";
import ChatShowcase from "@/components/profile/ChatShowcase";
import ServerProfileSection from "@/components/profile/ServerProfileSection";
import IgnoreListSection from "@/components/profile/IgnoreListSection";

type ConnectTab = "profile" | "appearance" | "privacy";

const TABS: { id: ConnectTab; label: string }[] = [
  { id: "profile", label: "Профиль" },
  { id: "appearance", label: "Внешний вид" },
  { id: "privacy", label: "Приватность" },
];

export default function ConnectSettings({
  role,
  isPremium,
}: {
  role: string;
  isPremium: boolean;
}) {
  const [tab, setTab] = useState<ConnectTab>("profile");

  return (
    <div className="space-y-4">
      <SettingsTabs tabs={TABS} value={tab} onChange={setTab} />

      {tab === "profile" && (
        <div className="space-y-4">
          <ConnectProfileSettings role={role} isPremium={isPremium} />
          <ServerProfileSection />
        </div>
      )}

      {tab === "appearance" && (
        <div className="space-y-4">
          <ChatAppearanceSettings />
          <ChatShowcase />
        </div>
      )}

      {tab === "privacy" && (
        <div className="space-y-4">
          <IgnoreListSection />
        </div>
      )}
    </div>
  );
}
