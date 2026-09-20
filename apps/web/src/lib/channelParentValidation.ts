import prisma from "@/lib/prisma";

/**
 * Единая проверка parentId для POST и PUT каналов.
 * Возвращает текст ошибки либо null.
 */
export async function validateChannelParent(input: {
  parentId: string | null;
  groupId: string;
  channelType: string;
  currentChannelId?: string;
}): Promise<string | null> {
  const { parentId, groupId, channelType, currentChannelId } = input;
  if (channelType === "CATEGORY" && parentId) return "Category cannot have parent";
  if (!parentId) return null;
  if (parentId === currentChannelId) return "Channel cannot be its own parent";

  const parent = await prisma.channel.findUnique({
    where: { id: parentId },
    select: {
      id: true,
      type: true,
      groupId: true,
      parentId: true,
      channelGroupType: true,
      group: { select: { isMain: true, sectionsEnabled: true } },
    },
  });
  if (!parent || parent.groupId !== groupId) return "Invalid parent category";

  const isSectionBlock =
    !parent.parentId &&
    parent.type !== "VOICE" &&
    parent.type !== "APPEALS" &&
    (parent.group.isMain || parent.group.sectionsEnabled);
  if (parent.type !== "CATEGORY" && !isSectionBlock) return "Parent must be a category";

  if (parent.type === "CATEGORY") {
    const expectedType = parent.channelGroupType === "VOICE" ? "VOICE" : "TEXT";
    if (expectedType === "VOICE" && channelType !== "VOICE") {
      return "Voice category can contain only voice channels";
    }
    if (expectedType === "TEXT" && channelType === "VOICE") {
      return "Text category cannot contain voice channels";
    }
  } else if (channelType === "VOICE" || channelType === "CATEGORY" || channelType === "APPEALS") {
    return "Этот тип нельзя добавить пунктом списка";
  }
  return null;
}