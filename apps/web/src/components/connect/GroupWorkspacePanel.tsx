"use client";

import { useMemo } from "react";
import WorkspaceCanvas from "@/components/workspace/WorkspaceCanvas";
import { ModuleSettingsButton } from "@/components/connect/ModuleSettingsModal";

/**
 * GROUP-WORKSPACE: групповой модуль «Рабочая среда».
 *
 * Тонкая обёртка над личным движком холста (WorkspaceCanvas): переключает его в
 * групповой режим (remote), где состояние холстов грузится/сохраняется по
 * каналу-модулю, а правки участников синхронизируются в реальном времени через
 * комнату канала. Право на редактирование определяет сервер (canEdit); если его
 * нет — среда открывается только для чтения. Доступ на просмотр (ограничение по
 * ролям, «модераторы+ всегда») и скелетирование обеспечиваются общей механикой
 * модульных каналов: раздел просто не показывается участникам без доступа.
 */
export default function GroupWorkspacePanel({
  channelId,
  channelName,
  currentUserId,
  currentUserName,
  canModerate,
  onBack,
}: {
  channelId: string;
  channelName: string;
  currentUserId: string;
  currentUserName: string;
  canModerate: boolean;
  onBack?: () => void;
}) {
  const remote = useMemo(
    () => ({
      channelId,
      loadUrl: `/api/channels/${channelId}/workspace`,
      saveUrl: `/api/channels/${channelId}/workspace`,
    }),
    [channelId],
  );

  return (
    <WorkspaceCanvas
      key={channelId}
      userId={currentUserId}
      userName={currentUserName}
      remote={remote}
      embedded
      title={channelName}
      subtitle="Рабочая среда · совместные холсты"
      onBack={onBack}
      headerActions={canModerate ? <ModuleSettingsButton channelId={channelId} /> : undefined}
    />
  );
}
