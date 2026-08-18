"use client";

/**
 * BoardInboxListener — приёмник сообщений из чата на стороне канваса.
 *
 * Рендерится внутри WorkspaceCanvas и ничего не рисует. При монтировании
 * забирает накопившуюся очередь (сообщения, отправленные на доску, пока
 * канвас был закрыт) и подписывается на новые.
 *
 * Интеграция (см. PATCHES.md, раздел F): внутри WorkspaceCanvas вызовите
 * свою функцию создания заметки в onItem.
 */

import { useEffect, useRef } from "react";
import {
  drainBoardInbox,
  subscribeBoardInbox,
  type BoardInboxItem,
  type BoardScope,
} from "@/lib/boardBridge";

/** Готовый текст для заметки-карточки на доске. */
export function boardItemToNoteText(item: BoardInboxItem): string {
  const source = [
    item.authorName ? `— ${item.authorName}` : null,
    item.channelName ? `#${item.channelName}` : null,
  ]
    .filter(Boolean)
    .join(", ");
  return source ? `${item.content}\n\n${source}` : item.content;
}

export default function BoardInboxListener({
  onItem,
  scope,
}: {
  /** Создайте здесь заметку на доске штатным механизмом канваса */
  onItem: (item: BoardInboxItem) => void;
  /** FIX-BOARDSCOPE: берём только то, что адресовано этому холсту. */
  scope?: BoardScope;
}) {
  // Стабильная ссылка, чтобы не переподписываться на каждый рендер.
  const onItemRef = useRef(onItem);
  useEffect(() => {
    onItemRef.current = onItem;
  }, [onItem]);

  useEffect(() => {
    // 1) Забрать накопившееся своей области, пока доска была закрыта.
    drainBoardInbox(scope).forEach((item) => onItemRef.current(item));
    // 2) Живая подписка (текущая и соседние вкладки).
    return subscribeBoardInbox((item) => onItemRef.current(item), scope);
  }, [scope]);

  return null;
}
