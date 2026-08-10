"use client";

// TZ.Connect — кликабельное название группы с выпадающим меню настроек.
// Заменяет шестерёнку и отдельную кнопку «Покинуть сообщество» в ChannelSidebar.
//
// Поведение (как в Discord):
// - клик по названию группы открывает меню со всеми действиями по группе;
// - у модераторов/владельца: настройки, инвайты, создание канала, участники, мьют;
// - у обычного участника: участники, мьют и скромный пункт «Покинуть сообщество»
//   (с подтверждением вторым кликом) вместо яркой отдельной кнопки.

import { useCallback, useEffect, useRef, useState } from "react";
import { BellIcon, GearIcon } from "@/components/ui/ConnectIcons";
import { MailIcon, PlusIcon } from "@/components/ui/ConnectIconsExtra";

interface GroupHeaderMenuProps {
  groupId: string;
  name: string;
  description?: string | null;
  memberCount: number;
  canManage: boolean;
  isOwner: boolean;
  isMainCommunity: boolean;
  onOpenSettings?: () => void;
  onInvite?: () => void;
  onCreateChannel?: () => void;
  onLeaveGroup?: () => void;
}

const wrapStyle: React.CSSProperties = { position: "relative" };

const headerBtnStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "10px 12px",
  cursor: "pointer",
  background: "transparent",
  border: "none",
  textAlign: "left",
  color: "inherit",
  borderRadius: 8,
};

const nameStyle: React.CSSProperties = {
  fontWeight: 700,
  fontSize: 15,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
  flex: 1,
  minWidth: 0,
};

const descStyle: React.CSSProperties = {
  padding: "0 12px 8px",
  fontSize: 11.5,
  opacity: 0.6,
  whiteSpace: "nowrap",
  overflow: "hidden",
  textOverflow: "ellipsis",
};

const chevStyle: React.CSSProperties = {
  fontSize: 10,
  opacity: 0.6,
  transition: "transform 0.15s ease",
  flexShrink: 0,
};

const chevOpenStyle: React.CSSProperties = {
  ...chevStyle,
  transform: "rotate(180deg)",
};

const panelStyle: React.CSSProperties = {
  position: "absolute",
  top: "calc(100% + 4px)",
  left: 8,
  right: 8,
  zIndex: 60,
  borderRadius: 10,
  border: "1px solid rgba(128,128,128,0.25)",
  background: "var(--cn-panel, var(--background, #16161a))",
  boxShadow: "0 12px 32px rgba(0,0,0,0.35)",
  padding: 4,
};

const metaBlockStyle: React.CSSProperties = {
  padding: "6px 10px 8px",
  fontSize: 11,
  opacity: 0.55,
};

const itemStyle: React.CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  width: "100%",
  padding: "8px 10px",
  borderRadius: 6,
  background: "transparent",
  border: "none",
  cursor: "pointer",
  fontSize: 13,
  textAlign: "left",
  color: "inherit",
};

// Скромный пункт выхода: обычная строка меню, приглушённый красный, без заливки.
const dangerItemStyle: React.CSSProperties = {
  ...itemStyle,
  color: "#e5484d",
  opacity: 0.8,
  fontSize: 12.5,
};

const dividerStyle: React.CSSProperties = {
  height: 1,
  margin: "4px 6px",
  background: "rgba(128,128,128,0.2)",
};

export default function GroupHeaderMenu(props: GroupHeaderMenuProps) {
  const {
    groupId,
    name,
    description,
    memberCount,
    canManage,
    isOwner,
    isMainCommunity,
    onOpenSettings,
    onInvite,
    onCreateChannel,
    onLeaveGroup,
  } = props;

  const [open, setOpen] = useState(false);
  const [muted, setMuted] = useState<boolean | null>(null);
  const [confirmLeave, setConfirmLeave] = useState(false);
  const wrapRef = useRef<HTMLDivElement>(null);

  // Закрытие по клику снаружи и по Escape
  useEffect(() => {
    if (!open) {
      setConfirmLeave(false);
      return;
    }
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Ленивая загрузка состояния мьюта при первом открытии меню
  useEffect(() => {
    if (!open || muted !== null) return;
    fetch("/api/channels/mute?groupId=" + groupId, { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) setMuted(d.groupMuted === true);
      })
      .catch(() => {});
  }, [open, muted, groupId]);

  const toggleMute = useCallback(() => {
    const next = !(muted === true);
    setMuted(next);
    fetch("/api/channels/mute", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ groupId, muted: next }),
    }).catch(() => {});
  }, [muted, groupId]);

  const pick = useCallback((fn?: () => void) => {
    setOpen(false);
    if (fn) fn();
  }, []);

  const showLeave = !!onLeaveGroup && !isOwner && !isMainCommunity;

  return (
    <div ref={wrapRef} style={wrapStyle}>
      <button
        type="button"
        style={headerBtnStyle}
        onClick={() => setOpen((v) => !v)}
        title="Меню сообщества"
        aria-expanded={open}
      >
        <span style={nameStyle}>{name}</span>
        <span style={open ? chevOpenStyle : chevStyle}>▾</span>
      </button>
      {description ? <div style={descStyle}>{description}</div> : null}

      {open && (
        <div style={panelStyle} role="menu">
          <div style={metaBlockStyle}>{memberCount} участников</div>

          {/* FIX-PANELVIEW3: пункт «Участники» убран — список живёт в правой
              панели. Число участников выше по-прежнему видно. */}
          {canManage && onInvite && (
            <button type="button" style={itemStyle} onClick={() => pick(onInvite)}>
              <MailIcon size={16} /> Пригласить людей
            </button>
          )}
          {canManage && onCreateChannel && (
            <button type="button" style={itemStyle} onClick={() => pick(onCreateChannel)}>
              <PlusIcon size={16} /> Создать канал
            </button>
          )}
          {canManage && onOpenSettings && (
            <button type="button" style={itemStyle} onClick={() => pick(onOpenSettings)}>
              <GearIcon size={16} /> Настройки сообщества
            </button>
          )}

          <button type="button" style={itemStyle} onClick={toggleMute}>
            {muted === true ? (
              <>
                <BellIcon size={16} crossed tone="muted" /> Уведомления: выключены
              </>
            ) : (
              <>
                <BellIcon size={16} /> Уведомления: включены
              </>
            )}
          </button>

          {showLeave && (
            <>
              <div style={dividerStyle} />
              {confirmLeave ? (
                <button type="button" style={dangerItemStyle} onClick={() => pick(onLeaveGroup)}>
                  Точно покинуть сообщество?
                </button>
              ) : (
                <button type="button" style={dangerItemStyle} onClick={() => setConfirmLeave(true)}>
                  Покинуть сообщество
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
