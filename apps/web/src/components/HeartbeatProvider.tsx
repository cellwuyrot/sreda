"use client";

import { useSession } from "next-auth/react";
import { useHeartbeat } from "@/hooks/useHeartbeat";
import { usePushDevice } from "@/hooks/usePushDevice";
import { useNavStackTracker } from "@/hooks/useBackStep";

/**
 * Фоновые заботы, которым не нужен свой экран.
 *
 * PUSH: привязка устройства живёт здесь по той же причине, что и удар сети —
 * это должно работать на любой странице, а не только в мессенджере. Иначе
 * уведомления зависели бы от того, где человек был в момент запуска приложения.
 *
 * BACK-STEP: след посещений — тоже здесь, и он единственный, кто работает и для
 * не вошедших: «назад» нужно и на входе, и в настройках, и в админке.
 */
export function HeartbeatProvider() {
  const { data: session } = useSession();
  useHeartbeat();
  usePushDevice((session?.user as { id?: string } | undefined)?.id);
  useNavStackTracker();
  return null;
}
