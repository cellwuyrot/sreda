/**
 * Тесты: модерация участника голосового канала прямо из боковой панели.
 *
 * Почему тест на весь сайдбар, а не на его части. Заглушение микрофона
 * складывается из шести звеньев: строка участника ловит правый щелчок → панель
 * спрашивает права у `moderation-info` → рисует кнопки → щелчок уходит в
 * `force-mute` → сервер рассылает обновлённый состав комнаты → панель по флагу
 * `isForceMuted` меняет «Заглушить» на «Снять заглушение». Ошибка в любом из
 * звеньев выглядит для человека одинаково: «нажимаю — ничего». Ровно так и
 * случилось дважды: сначала меню закрывалось от собственного mousedown, потом
 * снять заглушение стало нельзя вовсе. Проверять такое по частям бессмысленно —
 * каждая часть по отдельности «работает».
 *
 * Сокет и сеть подменены: проверяется поведение панели, а не транспорт.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, fireEvent, render, screen, waitFor } from "@testing-library/react";

import type { GroupDetail, VoiceState, VoiceActions, VoiceUser } from "./sidebarTypes";

/* ── Заглушка socket.io-client ─────────────────────────────────────────────
   Панель держит собственное соединение ради присутствия в голосовых каналах.
   Здесь оно нужно только для того, чтобы отдать панели состав комнаты — то же,
   что в жизни присылает событие `voice-channel-users`. */
type Handler = (payload: unknown) => void;

const sockHandlers = new Map<string, Handler[]>();
const sockEmits: Array<{ event: string; payload?: unknown }> = [];

const fakeSocket = {
  connected: true,
  on: (event: string, cb: Handler) => {
    sockHandlers.set(event, [...(sockHandlers.get(event) ?? []), cb]);
    return fakeSocket;
  },
  off: () => fakeSocket,
  emit: (event: string, payload?: unknown) => {
    sockEmits.push({ event, payload });
    return fakeSocket;
  },
  disconnect: () => {},
  io: { on: () => {} },
};

vi.mock("socket.io-client", () => ({ io: () => fakeSocket }));

/* Тяжёлые дочерние окна и панели к модерации отношения не имеют. */
vi.mock("./ChannelSettingsModal", () => ({ ChannelSettingsModal: () => null }));
vi.mock("./SectionsPanel", () => ({ default: () => null }));
vi.mock("./ModulesPanel", () => ({ default: () => null }));
vi.mock("./GroupHeaderMenu", () => ({ default: () => null }));
vi.mock("./CooperationButton", () => ({ default: () => null }));
vi.mock("@/components/voice/ScreenSharePrivacyModal", () => ({ default: () => null }));

const ChannelSidebar = (await import("./ChannelSidebar")).default;

/** Отдать панели состав голосовой комнаты, как это делает сервер. */
function pushRoom(channelId: string, users: VoiceUser[]) {
  for (const cb of sockHandlers.get("voice-channel-users") ?? []) {
    act(() => cb({ channelId, users }));
  }
}

const VOICE_A = {
  id: "voice-a",
  name: "Совет",
  type: "VOICE",
  icon: null,
  groupId: "g1",
  parentId: null,
  _count: { members: 0, messages: 0 },
};
const VOICE_B = { ...VOICE_A, id: "voice-b", name: "Библиотека" };

const GROUP: GroupDetail = {
  id: "g1",
  name: "Сообщество",
  icon: null,
  description: "",
  myRole: "OWNER",
  channels: [VOICE_A, VOICE_B],
  members: [],
};

/** Я — владелец сообщества и сижу в голосовом канале «Совет». */
const ME = { id: "me", name: "Владелец", avatar: null };
const PEER: VoiceUser = { socketId: "s-peer", userId: "peer", userName: "Участник", muted: false };

const voiceState = (users: VoiceUser[]): VoiceState =>
  ({
    isConnected: true,
    voiceStatus: "connected",
    connectionStage: "connected",
    channelId: VOICE_A.id,
    channelName: VOICE_A.name,
    isMuted: false,
    isDeafened: false,
    users,
    speakingUsers: new Set<string>(),
    localSpeaking: false,
    nsEnabled: false,
    nsStatus: "",
    isSharingScreen: false,
    screenSharerId: null,
    screenSharerIds: new Set<string>(),
    userVolumes: new Map<string, number>(),
    connectionQuality: new Map(),
    localPing: null,
  }) as unknown as VoiceState;

const voiceActions = {
  joinVoice: vi.fn(),
  leaveVoice: vi.fn(),
  toggleMute: vi.fn(),
  toggleDeafen: vi.fn(),
  toggleNS: vi.fn(),
  startScreenShare: vi.fn(),
  stopScreenShare: vi.fn(),
  setUserVolume: vi.fn(),
} as unknown as VoiceActions;

/** Права из `moderation-info`: владелец может всё над участником. */
const FULL_RIGHTS = {
  groupId: "g1",
  myRole: "OWNER",
  myRank: 4,
  targetRole: "MEMBER",
  canKickVoice: true,
  canForceMute: true,
  canForceDeafen: true,
  canMove: true,
  canBan: true,
  voiceChannels: [{ id: VOICE_B.id, name: VOICE_B.name }],
};

const fetchMock = vi.fn();

function renderSidebar(users: VoiceUser[] = [PEER], myRole = "OWNER") {
  return render(
    <ChannelSidebar
      groupDetail={{ ...GROUP, myRole }}
      selectedChannel={null}
      unreadCounts={{}}
      /* Владелец и администратор — это canManage; модератору и проводнику
         власть над голосовыми каналами выдают отдельно, и здесь проверяется
         именно она. */
      canManage={myRole === "OWNER" || myRole === "ADMIN"}
      myProfileUser={ME}
      userName={ME.name}
      userUsername="owner"
      userRole="ADMIN"
      onChannelClick={() => {}}
      onDeleteChannel={() => {}}
      onCreateChannel={() => {}}
      onInvite={() => {}}
      onProfileSettings={() => {}}
      memberCount={2}
      voiceState={voiceState(users)}
      voiceActions={voiceActions}
    />,
  );
}

/**
 * Событие указателя с полями, по которым хук отличает мышь от касания.
 *
 * jsdom не реализует PointerEvent: у события, созданного `fireEvent.pointerDown`,
 * нет ни `pointerType`, ни `button`, и обработчик отсеивает его как чужой. Это
 * особенность окружения, а не поведение приложения, поэтому жест собирается из
 * MouseEvent с дописанным `pointerType` — так же, как его видит браузер.
 */
function pointerEvent(type: string, x: number, y: number) {
  const event = new MouseEvent(type, { clientX: x, clientY: y, button: 0, bubbles: true });
  Object.defineProperty(event, "pointerType", { value: "mouse" });
  return event;
}

/** Правый щелчок по строке участника — так открывается меню модерации. */
async function openModMenu(name = PEER.userName) {
  const row = screen.getByText(name).closest("div.group\\/user");
  expect(row).not.toBeNull();
  fireEvent.contextMenu(row!, { clientX: 40, clientY: 80 });
  await waitFor(() => expect(modInfoUrls()).toHaveLength(1));
}

/** Адреса запросов прав — их панель делает при открытии меню. */
function modInfoUrls() {
  return fetchMock.mock.calls
    .map((call) => String(call[0]))
    .filter((url) => url.includes("/api/voice/moderation-info"));
}

/** Тела POST-запросов к маршруту. */
function bodiesFor(path: string) {
  return fetchMock.mock.calls
    .filter((call) => String(call[0]).includes(path) && call[1]?.method === "POST")
    .map((call) => JSON.parse(String(call[1].body)));
}

beforeEach(() => {
  sockHandlers.clear();
  sockEmits.length = 0;
  fetchMock.mockReset();
  fetchMock.mockImplementation((url: string) => {
    if (String(url).includes("/api/voice/moderation-info")) {
      return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_RIGHTS) });
    }
    return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
  });
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("меню модерации участника в боковой панели", () => {
  it("правый щелчок по участнику спрашивает права именно для него", async () => {
    renderSidebar();
    await openModMenu();

    const url = modInfoUrls()[0];
    expect(url).toContain("channelId=voice-a");
    expect(url).toContain("targetUserId=peer");
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: нажатие на пункт меню доводит дело до сервера.
   *
   * Меню закрывалось от своего же `mousedown` — портал снимался до `mouseup`,
   * события `click` не возникало вовсе, и все пункты были мёртвыми. Поэтому
   * здесь именно полный щелчок (mousedown + mouseup + click), а не вызов
   * обработчика напрямую: обработчик-то был исправен.
   */
  it("ИНВАРИАНТ: «Заглушить микрофон» доходит до force-mute", async () => {
    renderSidebar();
    await openModMenu();

    const button = await screen.findByRole("menuitem", { name: /Заглушить микрофон/ });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    await waitFor(() => expect(bodiesFor("/api/voice/force-mute")).toHaveLength(1));
    expect(bodiesFor("/api/voice/force-mute")[0]).toEqual({
      targetUserId: "peer",
      channelId: "voice-a",
      deafen: false,
    });
  });

  it("ИНВАРИАНТ: «Заглушить мик + наушники» доходит с признаком deafen", async () => {
    renderSidebar();
    await openModMenu();

    const button = await screen.findByRole("menuitem", { name: /наушники/ });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    await waitFor(() => expect(bodiesFor("/api/voice/force-mute")).toHaveLength(1));
    expect(bodiesFor("/api/voice/force-mute")[0].deafen).toBe(true);
  });

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: заглушение обратимо ВСЕГДА.
   *
   * Пункт выбирался по флагу из снимка состава комнаты: заглушён — только
   * «снять», не заглушён — только «заглушить». Снимок устаревает от любого
   * обрыва связи и от перехода в канал и обратно, и тогда единственный
   * показанный пункт оказывался ровно не тем, который нужен: человек сидит без
   * микрофона, а панель предлагает его заглушить. Мера без снятия — это не
   * мера, а необратимое наказание, поэтому обе показываются вместе.
   */
  it("ИНВАРИАНТ: снятие предлагается даже когда снимок считает участника незаглушённым", async () => {
    renderSidebar();
    pushRoom(VOICE_A.id, [{ ...PEER, isForceMuted: false }]);
    await openModMenu();

    const button = await screen.findByRole("menuitem", { name: /Снять заглушение/ });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    await waitFor(() => expect(bodiesFor("/api/voice/force-unmute")).toHaveLength(1));
    /* Что именно снимать — микрофон или микрофон с наушниками — решает сервер
       по своему состоянию: клиентский снимок для этого недостаточно надёжен. */
    expect(bodiesFor("/api/voice/force-unmute")[0]).toEqual({
      targetUserId: "peer",
      channelId: "voice-a",
    });
  });

  it("ИНВАРИАНТ: заглушение предлагается даже когда снимок считает участника заглушённым", async () => {
    renderSidebar();
    pushRoom(VOICE_A.id, [{ ...PEER, isForceMuted: true, isForceDeafened: true }]);
    await openModMenu();

    const mic = await screen.findByRole("menuitem", { name: /Заглушить микрофон/ });
    fireEvent.mouseDown(mic);
    fireEvent.mouseUp(mic);
    fireEvent.click(mic);

    await waitFor(() => expect(bodiesFor("/api/voice/force-mute")).toHaveLength(1));
  });

  /**
   * ИНВАРИАНТ: меру можно применить, не заходя в канал.
   *
   * Прежде меню требовало, чтобы модератор сам сидел в этом канале, — при этом
   * перетаскивать таких же участников из панели было можно. Одна и та же власть
   * то была, то нет, и объяснить это человеку нечем.
   */
  it("ИНВАРИАНТ: меню открывается и для чужого канала, в котором меня нет", async () => {
    renderSidebar([]);
    /* Участник сидит в «Библиотеке», а я — в «Совете» (см. voiceState). */
    pushRoom(VOICE_B.id, [PEER]);

    await openModMenu();
    const url = modInfoUrls()[0];
    expect(url).toContain("channelId=voice-b");

    const button = await screen.findByRole("menuitem", { name: /Заглушить микрофон/ });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    await waitFor(() => expect(bodiesFor("/api/voice/force-mute")).toHaveLength(1));
    expect(bodiesFor("/api/voice/force-mute")[0].channelId).toBe("voice-b");
  });

  /**
   * ИНВАРИАНТ: отказ виден. Молча закрытое меню и неработающая кнопка выглядят
   * для человека одинаково, а лечатся совершенно по-разному.
   */
  it("ИНВАРИАНТ: отказ сервера показывается, а меню остаётся открытым", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/voice/moderation-info")) {
        return Promise.resolve({ ok: true, json: () => Promise.resolve(FULL_RIGHTS) });
      }
      if (String(url).includes("/api/voice/force-mute")) {
        return Promise.resolve({ ok: false, status: 403, json: () => Promise.resolve({ error: "Rank too low" }) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });

    renderSidebar();
    await openModMenu();

    const button = await screen.findByRole("menuitem", { name: /Заглушить микрофон/ });
    fireEvent.mouseDown(button);
    fireEvent.mouseUp(button);
    fireEvent.click(button);

    expect(await screen.findByText(/Звание участника не ниже вашего/)).toBeTruthy();
    expect(screen.queryByRole("menuitem", { name: /Заглушить микрофон/ })).not.toBeNull();
  });

  it("права не пришли — меню объясняет, а не исчезает", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/voice/moderation-info")) {
        return Promise.resolve({ ok: false, status: 500, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });

    renderSidebar();
    await openModMenu();

    expect(await screen.findByText(/Не удалось получить права/)).toBeTruthy();
  });

  it("нет прав над участником — меню говорит об этом прямо", async () => {
    fetchMock.mockImplementation((url: string) => {
      if (String(url).includes("/api/voice/moderation-info")) {
        return Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              ...FULL_RIGHTS,
              canKickVoice: false, canForceMute: false, canForceDeafen: false, canMove: false, canBan: false,
            }),
        });
      }
      return Promise.resolve({ ok: true, json: () => Promise.resolve({ ok: true }) });
    });

    renderSidebar();
    await openModMenu();

    expect(await screen.findByText(/Мер модерации к этому участнику у вас нет/)).toBeTruthy();
  });

  it("нажатие мимо меню закрывает его", async () => {
    renderSidebar();
    await openModMenu();
    expect(await screen.findByRole("menuitem", { name: /Заглушить микрофон/ })).toBeTruthy();

    fireEvent.mouseDown(document.body);
    await waitFor(() =>
      expect(screen.queryByRole("menuitem", { name: /Заглушить микрофон/ })).toBeNull(),
    );
  });
});

describe("порог звания для мер в голосовом канале", () => {
  /**
   * ИНВАРИАНТ: меры доступны модерации, а не только владельцу.
   *
   * Признак `canManage` — это владелец или администратор. Модератор и
   * проводник, которым власть над голосовыми каналами как раз и выдают,
   * оставались без неё: правый щелчок ничего не открывал, перетащить участника
   * было нельзя.
   */
  it("ИНВАРИАНТ: модератор открывает меню мер", async () => {
    renderSidebar([PEER], "MODERATOR");
    await openModMenu();
    expect(await screen.findByRole("menuitem", { name: /Заглушить микрофон/ })).toBeTruthy();
  });

  it("проводник тоже открывает меню мер", async () => {
    renderSidebar([PEER], "GUIDE");
    await openModMenu();
    expect(await screen.findByRole("menuitem", { name: /Заглушить микрофон/ })).toBeTruthy();
  });

  /* Обычному участнику меры не предлагаются вовсе: сервер ему всё равно
     откажет, а лишний запрос прав на каждый правый щелчок никому не нужен. */
  it("обычный участник мер не получает", async () => {
    renderSidebar([PEER], "MEMBER");
    const row = screen.getByText(PEER.userName).closest("div.group\\/user")!;
    fireEvent.contextMenu(row, { clientX: 40, clientY: 80 });
    expect(modInfoUrls()).toHaveLength(0);
  });
});

describe("перенос участника перетаскиванием", () => {
  /** jsdom не считает раскладку — говорим, что лежит под курсором. */
  function pointAt(el: Element | null) {
    document.elementFromPoint = () => el as Element;
  }

  /**
   * ИНВАРИАНТ И ЕСТЬ САМ БАГ: перетаскивание участника на другой голосовой
   * канал переносит его туда. Гесты собираются вручную из pointer-событий, и
   * сеанс дважды обрывался на полпути — в обоих случаях внешне это выглядело
   * как «перетаскивание не поддерживается».
   */
  it("ИНВАРИАНТ: перетаскивание на другой канал вызывает move-user", async () => {
    renderSidebar();

    const row = screen.getByText(PEER.userName).closest("div.group\\/user")!;
    const target = document.querySelector('[data-voice-channel-id="voice-b"]');
    expect(target).not.toBeNull();

    fireEvent(row, pointerEvent("pointerdown", 10, 10));
    pointAt(target);
    act(() => {
      window.dispatchEvent(pointerEvent("pointermove", 80, 200));
    });
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 80, 200));
    });

    await waitFor(() => expect(bodiesFor("/api/voice/move-user")).toHaveLength(1));
    expect(bodiesFor("/api/voice/move-user")[0]).toEqual({
      targetUserId: "peer",
      targetChannelId: "voice-b",
      groupId: "g1",
    });
  });

  it("ИНВАРИАНТ: модератор переносит участника, не будучи владельцем", async () => {
    renderSidebar([PEER], "MODERATOR");

    const row = screen.getByText(PEER.userName).closest("div.group\\/user")!;
    const target = document.querySelector('[data-voice-channel-id="voice-b"]');

    fireEvent(row, pointerEvent("pointerdown", 10, 10));
    pointAt(target);
    act(() => { window.dispatchEvent(pointerEvent("pointermove", 80, 200)); });
    act(() => { window.dispatchEvent(pointerEvent("pointerup", 80, 200)); });

    await waitFor(() => expect(bodiesFor("/api/voice/move-user")).toHaveLength(1));
  });

  it("обычный участник никого не перетаскивает", async () => {
    renderSidebar([PEER], "MEMBER");

    const row = screen.getByText(PEER.userName).closest("div.group\\/user")!;
    const target = document.querySelector('[data-voice-channel-id="voice-b"]');

    fireEvent(row, pointerEvent("pointerdown", 10, 10));
    pointAt(target);
    act(() => { window.dispatchEvent(pointerEvent("pointermove", 80, 200)); });
    act(() => { window.dispatchEvent(pointerEvent("pointerup", 80, 200)); });

    expect(bodiesFor("/api/voice/move-user")).toHaveLength(0);
  });

  it("щелчок без перетаскивания никого не переносит", async () => {
    renderSidebar();
    const row = screen.getByText(PEER.userName).closest("div.group\\/user")!;

    fireEvent(row, pointerEvent("pointerdown", 10, 10));
    pointAt(null);
    act(() => {
      window.dispatchEvent(pointerEvent("pointerup", 10, 10));
    });

    expect(bodiesFor("/api/voice/move-user")).toHaveLength(0);
  });
});
