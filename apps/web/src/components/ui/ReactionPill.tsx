"use client";

import { TriozEmoji } from "./TriozEmoji";
import { findReactionEmoji } from "@/lib/reactionEmoji";

/** Shared visual shell; callers retain their existing permissions/API/toggle logic. */
export default function ReactionPill({ emoji, count, selected = false, onClick, imageUrl, title, size = 24 }: {
  emoji: string; count: number; selected?: boolean; onClick?: () => void; imageUrl?: string; title?: string; size?: number;
}) {
  const label = findReactionEmoji(emoji)?.label || emoji;
  const className = `tz-reaction-pill tz-modern-reaction${selected ? " is-selected" : ""}`;
  const content = <>{imageUrl
    // eslint-disable-next-line @next/next/no-img-element
    ? <img src={imageUrl} alt={label} title={label} width={size} height={size} style={{ width: size, height: size }} className="tz-emoji" loading="lazy" decoding="async" draggable={false} />
    : <TriozEmoji emoji={emoji} size={size} />}<span className="tz-reaction-count">{count}</span></>;
  const description = `${label}: ${count}${selected ? ", ваша реакция" : ""}`;
  return onClick
    ? <button type="button" className={className} onClick={onClick} aria-label={description} aria-pressed={selected} title={title || label}>{content}</button>
    : <span className={className} aria-label={description} title={title || label}>{content}</span>;
}
