/**
 * Тесты: DMMessageList — картинка не пересоздаётся при правке сообщения.
 *
 * Баг выглядел так: нажимаешь «изменить» у сообщения с картинками — картинки
 * мигают. Причина была в разметке: вложения стояли ВНУТРИ ветки «редактируем
 * или показываем», и переключение снимало их с дерева и вешало заново. Для
 * React это новый узел, для браузера — новая картинка, которую надо
 * перерисовать с нуля.
 *
 * Проверка здесь строгая и ровно про это: сравнивается САМ УЗЕЛ DOM до и после
 * входа в правку. Проверять «картинка на месте» бесполезно — она была на месте
 * и раньше, просто другая. Тождество узла (`toBe`) — единственное, что ловит
 * пересоздание.
 */
import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import DMMessageList from "@/components/dm/DMMessageList";
import type { Message } from "@/components/dm/dmTypes";

/* Тяжёлые дети к делу не относятся: важна только позиция вложений в дереве. */
vi.mock("@/components/connect/MessageHoverToolbar", () => ({
  default: ({ children }: { children?: React.ReactNode }) => <>{children}</>,
}));
vi.mock("@/components/connect/MessageBody", () => ({
  default: ({ text }: { text: string }) => <span>{text}</span>,
}));

const MSG: Message = {
  id: "m1",
  content: "подпись к картинке",
  userId: "u1",
  edited: false,
  deleted: false,
  attachments: JSON.stringify([{ url: "/uploads/messages/a.webp", name: "a.webp", size: 1024, isImage: true }]),
  createdAt: "2026-08-02T10:00:00.000Z",
  user: { id: "u1", name: "Я", username: "me", avatar: null, role: "USER", avatarGlowEnabled: false, avatarGlowColors: null },
};

function props(editingId: string | null) {
  const noop = () => {};
  return {
    messages: [MSG],
    currentUserId: "u1",
    selectedConvId: "c1",
    editingId,
    editContent: "подпись к картинке",
    onEditContentChange: noop,
    onSaveEdit: noop,
    onCancelEdit: noop,
    onReply: noop,
    onDelete: noop,
    openMessageMenuId: null,
    onToggleMenu: noop,
    showEmojiPicker: null,
    onToggleEmojiPicker: noop,
    onToggleReaction: noop,
    onPin: noop,
    onOpenThread: noop,
    onForward: noop,
    onFavorite: noop,
    onStartEdit: noop,
    peerReadAt: null,
    onResend: noop,
    onDecryptFile: async () => new ArrayBuffer(0),
    onImageClick: noop,
    scrollContainerRef: { current: null },
    winStart: 0,
    winEnd: 1,
    winPadTop: 0,
    winPadBottom: 0,
    messagesEndRef: { current: null },
    onScroll: noop,
    hasMore: false,
    nextCursor: null,
    messagesLoading: false,
    onLoadMore: noop,
    showScrollBtn: false,
    onScrollToBottom: noop,
  } as unknown as React.ComponentProps<typeof DMMessageList>;
}

describe("FIX-EDITBLINK: правка сообщения не пересоздаёт вложения", () => {
  it("ИНВАРИАНТ: узел картинки тот же самый до и после входа в правку", () => {
    const { container, rerender } = render(<DMMessageList {...props(null)} />);
    const before = container.querySelector('img[src="/uploads/messages/a.webp"]');
    expect(before).toBeTruthy();

    rerender(<DMMessageList {...props("m1")} />);
    const during = container.querySelector('img[src="/uploads/messages/a.webp"]');
    /* Именно tobe: другой объект означает, что React снял узел и повесил
       заново — то самое мигание. */
    expect(during).toBe(before);
  });

  it("узел остаётся тем же и на выходе из правки", () => {
    const { container, rerender } = render(<DMMessageList {...props("m1")} />);
    const during = container.querySelector('img[src="/uploads/messages/a.webp"]');
    expect(during).toBeTruthy();

    rerender(<DMMessageList {...props(null)} />);
    expect(container.querySelector('img[src="/uploads/messages/a.webp"]')).toBe(during);
  });

  it("во время правки картинка видна: правят как раз подпись к ней", () => {
    const { container } = render(<DMMessageList {...props("m1")} />);
    expect(container.querySelector('img[src="/uploads/messages/a.webp"]')).toBeTruthy();
    // И поле ввода на месте — значит это действительно режим правки.
    expect(container.querySelector("input")).toBeTruthy();
  });
});
