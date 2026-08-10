import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import prisma from "@/lib/prisma";
import { rateLimit } from "@/lib/rateLimit";
import { decrypt, isEncrypted } from "@/lib/encryption";

// Roles that bypass the daily request limit
const UNLIMITED_ROLES = ["ADMIN", "EDITOR", "CONSULTANT"];
const DAILY_LIMIT = 10;

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const chats = await prisma.aiChat.findMany({
    where: { userId: session.user.id },
    include: { messages: { take: 1, orderBy: { createdAt: "desc" } } },
    orderBy: { updatedAt: "desc" },
  });

  return NextResponse.json(chats);
}

export async function POST(req: NextRequest) {
  const limited = await rateLimit(req, "ai-chat", { limit: 30, windowMs: 60 * 60 * 1000 });
  if (limited) return limited;

  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { chatId, message } = await req.json();

  if (!message || typeof message !== "string" || message.trim().length === 0) {
    return NextResponse.json({ error: "Message is required" }, { status: 400 });
  }

  if (message.length > 8000) {
    return NextResponse.json({ error: "Message too long (max 8000 characters)" }, { status: 400 });
  }

  // --- Daily rate limit for regular users ---
  const userRole = (session.user as { role: string }).role;
  if (!UNLIMITED_ROLES.includes(userRole)) {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const usedToday = await prisma.aiMessage.count({
      where: {
        role: "user",
        createdAt: { gte: startOfDay },
        chat: { userId: session.user.id },
      },
    });

    if (usedToday >= DAILY_LIMIT) {
      return NextResponse.json(
        {
          error: `Достигнут дневной лимит запросов (${DAILY_LIMIT}). Лимит сбрасывается в полночь.`,
          limitReached: true,
          used: usedToday,
          limit: DAILY_LIMIT,
        },
        { status: 429 }
      );
    }
  }

  let chat;
  if (chatId) {
    chat = await prisma.aiChat.findFirst({
      where: { id: chatId, userId: session.user.id },
    });
    if (!chat) {
      return NextResponse.json({ error: "Chat not found" }, { status: 404 });
    }
  } else {
    chat = await prisma.aiChat.create({
      data: { userId: session.user.id, title: message.slice(0, 50) || "Новый диалог" },
    });
  }

  const userMessage = await prisma.aiMessage.create({
    data: { chatId: chat.id, role: "user", content: message },
  });

  // Try to call AI API if configured
  const apiKeyConfig = await prisma.siteConfig.findUnique({ where: { key: "ai_api_key" } });
  const modelConfig = await prisma.siteConfig.findUnique({ where: { key: "ai_model" } });
  const promptConfig = await prisma.siteConfig.findUnique({ where: { key: "ai_system_prompt" } });
  const providerConfig = await prisma.siteConfig.findUnique({ where: { key: "ai_provider" } });

  // Flag to track whether we got a real AI response or an error/fallback
  let aiResponseContent: string | null = null;
  let isError = false;

  if (!apiKeyConfig?.value) {
    // No API configured — save a one-time info message (not counted as AI response)
    aiResponseContent = "ИИ-ассистент пока не подключён. Администратор может настроить API в панели управления.";
  } else {
    let apiKey = apiKeyConfig.value;
    try {
      if (isEncrypted(apiKey)) apiKey = decrypt(apiKey);
    } catch {
      aiResponseContent = "Ошибка расшифровки API ключа. Обратитесь к администратору.";
    }
    if (aiResponseContent) {
      // skip AI call
    } else
    try {
      const allMessages = await prisma.aiMessage.findMany({
        where: { chatId: chat.id },
        orderBy: { createdAt: "asc" },
      });

      const apiMessages = [
        { role: "system", content: promptConfig?.value || "Ты — ИИ-ассистент экосистемы TrioZ. Отвечай на русском языке." },
        ...allMessages.map((m) => ({ role: m.role, content: m.content })),
      ];

      const provider = providerConfig?.value || "openai";
      let apiUrl = "https://api.openai.com/v1/chat/completions";
      if (provider === "anthropic") {
        apiUrl = "https://api.anthropic.com/v1/messages";
      }

      if (provider === "anthropic") {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "x-api-key": apiKey,
            "anthropic-version": "2023-06-01",
          },
          body: JSON.stringify({
            model: modelConfig?.value || "claude-sonnet-4-20250514",
            max_tokens: 1024,
            system: promptConfig?.value || "Ты — ИИ-ассистент экосистемы TrioZ. Отвечай на русском языке.",
            messages: allMessages.map((m) => ({ role: m.role, content: m.content })),
          }),
        });
        const data = await res.json();
        if (data.content?.[0]?.text) {
          aiResponseContent = data.content[0].text;
        } else {
          isError = true;
        }
      } else {
        const res = await fetch(apiUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: modelConfig?.value || "gpt-4o-mini",
            messages: apiMessages,
            max_tokens: 1024,
          }),
        });
        const data = await res.json();
        if (data.choices?.[0]?.message?.content) {
          aiResponseContent = data.choices[0].message.content;
        } else {
          isError = true;
        }
      }
    } catch {
      isError = true;
    }
  }

  // Only persist the assistant message if we got a real response.
  // On error, return 502 without polluting the chat history.
  if (isError) {
    // Roll back the user message so the request doesn't count against the limit
    await prisma.aiMessage.delete({
      where: { id: userMessage.id },
    });
    return NextResponse.json(
      { error: "Ошибка при обращении к ИИ API. Проверьте настройки." },
      { status: 502 }
    );
  }

  await prisma.aiMessage.create({
    data: { chatId: chat.id, role: "assistant", content: aiResponseContent! },
  });

  await prisma.aiChat.update({
    where: { id: chat.id },
    data: { updatedAt: new Date() },
  });

  const updatedChat = await prisma.aiChat.findUnique({
    where: { id: chat.id },
    include: { messages: { orderBy: { createdAt: "asc" } } },
  });

  return NextResponse.json(updatedChat);
}

export async function DELETE(req: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { searchParams } = new URL(req.url);
  const chatId = searchParams.get("chatId");
  if (!chatId) {
    return NextResponse.json({ error: "chatId required" }, { status: 400 });
  }

  await prisma.aiChat.deleteMany({
    where: { id: chatId, userId: session.user.id },
  });

  return NextResponse.json({ success: true });
}
