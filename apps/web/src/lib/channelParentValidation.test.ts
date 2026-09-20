import { beforeEach, describe, expect, it, vi } from "vitest";
import { prismaMock, row } from "@/test/prismaMock";

vi.mock("@/lib/prisma", () => ({ default: prismaMock }));

const { validateChannelParent } = await import("./channelParentValidation");

beforeEach(() => {
  prismaMock.channel.findUnique.mockReset();
});

describe("validateChannelParent", () => {
  it("не разрешает категорию из другой группы", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row({
      id: "parent",
      type: "CATEGORY",
      groupId: "other-group",
      parentId: null,
      channelGroupType: "VOICE",
      group: { isMain: false, sectionsEnabled: false },
    }));
    expect(await validateChannelParent({
      parentId: "parent",
      groupId: "group-1",
      channelType: "VOICE",
    })).toBe("Invalid parent category");
  });

  it("не разрешает TEXT внутри VOICE-категории", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row({
      id: "parent",
      type: "CATEGORY",
      groupId: "group-1",
      parentId: null,
      channelGroupType: "VOICE",
      group: { isMain: false, sectionsEnabled: false },
    }));
    expect(await validateChannelParent({
      parentId: "parent",
      groupId: "group-1",
      channelType: "TEXT",
    })).toBe("Voice category can contain only voice channels");
  });

  it("не разрешает VOICE внутри TEXT-категории", async () => {
    prismaMock.channel.findUnique.mockResolvedValue(row({
      id: "parent",
      type: "CATEGORY",
      groupId: "group-1",
      parentId: null,
      channelGroupType: "TEXT",
      group: { isMain: false, sectionsEnabled: false },
    }));
    expect(await validateChannelParent({
      parentId: "parent",
      groupId: "group-1",
      channelType: "VOICE",
    })).toBe("Text category cannot contain voice channels");
  });

  it("не разрешает назначить канал родителем самому себе", async () => {
    expect(await validateChannelParent({
      parentId: "channel-1",
      groupId: "group-1",
      channelType: "TEXT",
      currentChannelId: "channel-1",
    })).toBe("Channel cannot be its own parent");
  });
});