/**
 * @vitest-environment jsdom
 *
 * Тесты: boardBridge — очередь «чат → рабочая среда».
 *
 * Окружение с DOM: очередь живёт в localStorage и оповещает через события окна —
 * это клиентский модуль, хотя и лежит в lib.
 *
 * Проверяется адресация: элемент забирает только тот холст, которому он
 * отправлен. До этой правки выбор в пикере ни на что не влиял — групповой
 * элемент доставался тому холсту, который в этот момент открыт.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

import {
  drainBoardInbox,
  peekBoardInbox,
  sendMessageToBoard,
  subscribeBoardInbox,
} from "./boardBridge";

beforeEach(() => {
  localStorage.clear();
});

describe("sendMessageToBoard", () => {
  it("область выводится из канала, когда её не передали", () => {
    expect(sendMessageToBoard({ content: "из ЛС" }).scope).toBe("personal");
    expect(sendMessageToBoard({ content: "из канала", channelId: "ch1" }).scope).toBe("group");
  });

  it("явная область важнее канала: из группового чата можно выбрать личный холст", () => {
    const item = sendMessageToBoard({ content: "к себе", channelId: "ch1", scope: "personal" });
    expect(item.scope).toBe("personal");
    expect(item.targetChannelId).toBeUndefined();
  });

  it("канал-источник и канал-получатель хранятся отдельно", () => {
    const item = sendMessageToBoard({
      content: "на общий холст",
      channelId: "chat-1",
      channelName: "общий",
      scope: "group",
      targetChannelId: "canvas-2",
      boardId: "b7",
    });
    expect(item.channelId).toBe("chat-1");
    expect(item.targetChannelId).toBe("canvas-2");
    expect(item.boardId).toBe("b7");
  });
});

describe("drainBoardInbox", () => {
  it("личный холст берёт своё, групповое остаётся в очереди", () => {
    sendMessageToBoard({ content: "личное" });
    sendMessageToBoard({ content: "групповое", channelId: "ch1", scope: "group" });

    const mine = drainBoardInbox("personal", null);
    expect(mine.map((i) => i.content)).toEqual(["личное"]);
    expect(peekBoardInbox().map((i) => i.content)).toEqual(["групповое"]);
  });

  it("групповой холст берёт только адресованное своему каналу", () => {
    sendMessageToBoard({ content: "в первый", scope: "group", targetChannelId: "canvas-1" });
    sendMessageToBoard({ content: "во второй", scope: "group", targetChannelId: "canvas-2" });

    expect(drainBoardInbox("group", "canvas-2").map((i) => i.content)).toEqual(["во второй"]);
    expect(peekBoardInbox().map((i) => i.content)).toEqual(["в первый"]);
    expect(drainBoardInbox("group", "canvas-1").map((i) => i.content)).toEqual(["в первый"]);
    expect(peekBoardInbox()).toEqual([]);
  });

  it("элемент без адреса канала (старая очередь) достаётся любому холсту области", () => {
    sendMessageToBoard({ content: "без адреса", channelId: "ch1", scope: "group" });
    expect(drainBoardInbox("group", "canvas-9").map((i) => i.content)).toEqual(["без адреса"]);
  });
});

describe("subscribeBoardInbox", () => {
  it("живая подписка тоже уважает адрес канала", () => {
    const mine = vi.fn();
    const off = subscribeBoardInbox(mine, "group", "canvas-1");

    sendMessageToBoard({ content: "чужому холсту", scope: "group", targetChannelId: "canvas-2" });
    expect(mine).not.toHaveBeenCalled();
    /* Чужой элемент из очереди не выброшен — он дождётся своего холста. */
    expect(peekBoardInbox()).toHaveLength(1);

    sendMessageToBoard({ content: "этому холсту", scope: "group", targetChannelId: "canvas-1" });
    expect(mine).toHaveBeenCalledTimes(1);
    expect(peekBoardInbox()).toHaveLength(1);

    off();
  });
});
