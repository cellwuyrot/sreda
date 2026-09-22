import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/prisma", () => ({ default: {} }));
vi.mock("@/lib/sanitize", () => ({ sanitizeText: (value: string) => value }));
vi.mock("@/lib/connectPermissions", () => ({ getChannelPermissions: vi.fn() }));
vi.mock("@/lib/moderation", () => ({ getActiveTimeout: vi.fn() }));
vi.mock("@/lib/censorService", () => ({ checkCensor: vi.fn(), recordCensorHits: vi.fn() }));
vi.mock("@/lib/serverMentions", () => ({ resolveGroupMentions: vi.fn() }));
vi.mock("@/lib/createNotification", () => ({ createNotification: vi.fn(), createNotificationsBulk: vi.fn() }));
vi.mock("@/lib/messageLimits", () => ({ messageLengthError: vi.fn() }));
vi.mock("@/lib/premium", () => ({ hasPremium: vi.fn() }));
vi.mock("@/lib/presence", () => ({ isUserViewingChannel: vi.fn() }));

import { filterScheduledMentionRecipients } from "@/lib/publishScheduledMessage";

describe("scheduled mentions", () => {
  it("применяет те же mute/viewing правила, что обычное сообщение", () => {
    expect(filterScheduledMentionRecipients({
      candidates: ["visible", "channel-muted", "group-muted", "explicit-unmute", "viewing"],
      channelMutes: [
        { userId: "channel-muted", muted: true },
        { userId: "explicit-unmute", muted: false },
      ],
      mutedGroupUserIds: ["group-muted", "explicit-unmute"],
      viewingUserIds: ["viewing"],
    })).toEqual(["visible", "explicit-unmute"]);
  });
});
