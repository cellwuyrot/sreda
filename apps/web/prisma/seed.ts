import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import "dotenv/config";

const prisma = new PrismaClient();

/**
 * FIX-SEC-SEED: у паролей учётных записей больше нет значений по умолчанию.
 *
 * Было две беды сразу. Первая: без переменных окружения создавались рабочие
 * учётные записи с паролями «admin123» и «user123», причём две из них — с ролью
 * ADMIN. Вторая, менее заметная и более неприятная: upsert перезаписывал пароль
 * при КАЖДОМ прогоне. Администратор менял пароль на свой, следующий
 * `prisma db seed` при выкладке возвращал ему прежнее значение — и никто этого
 * не видел, пока не приходил тот, кто знает пароль из репозитория.
 *
 * Теперь пароль обязателен, задаётся только при создании учётной записи, а у
 * существующих не трогается вовсе.
 */
function requiredPassword(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length < 12) {
    throw new Error(
      `Переменная окружения ${name} не задана или короче 12 символов. ` +
        "Значений по умолчанию у паролей больше нет: задайте их перед запуском seed " +
        "(см. docs/server-actions.md).",
    );
  }
  return value;
}

async function main() {
  const adminPassword = await bcrypt.hash(requiredPassword("SEED_ADMIN_PASSWORD"), 12);
  const userPassword = await bcrypt.hash(requiredPassword("SEED_USER_PASSWORD"), 12);
  const acoulbotPassword = await bcrypt.hash(requiredPassword("SEED_ACOULBOT_PASSWORD"), 12);

  const admin = await prisma.user.upsert({
    where: { email: "admin@trioz.ru" },
    update: { emailVerified: true },
    create: {
      email: "admin@trioz.ru",
      username: "admin",
      name: "Администратор",
      password: adminPassword,
      role: "ADMIN",
      emailVerified: true,
    },
  });

  const user = await prisma.user.upsert({
    where: { email: "user@trioz.ru" },
    update: { emailVerified: true },
    create: {
      email: "user@trioz.ru",
      username: "user",
      name: "Пользователь",
      password: userPassword,
      role: "USER",
      emailVerified: true,
    },
  });

  await prisma.user.upsert({
    where: { email: "acoulbot@trioz.ru" },
    update: { emailVerified: true },
    create: {
      email: "acoulbot@trioz.ru",
      username: "acoulbot",
      name: "acoulbot",
      password: acoulbotPassword,
      role: "ADMIN",
      emailVerified: true,
    },
  });

  // Create main community group (TZ Connect)
  const mainGroup = await prisma.group.upsert({
    where: { id: "trioz-main" },
    update: { isMain: true, name: "TZ Connect", description: "Главное сообщество TZ Connect" },
    create: {
      id: "trioz-main",
      name: "TZ Connect",
      icon: "🏰",
      description: "Главное сообщество TZ Connect",
      isMain: true,
      ownerId: admin.id,
    },
  });

  // All admins are OWNER, all other users are MEMBER
  const allUsers = await prisma.user.findMany({ select: { id: true, role: true } });
  for (const u of allUsers) {
    await prisma.groupMember.upsert({
      where: { userId_groupId: { userId: u.id, groupId: mainGroup.id } },
      update: { role: u.role === "ADMIN" ? "OWNER" : "MEMBER" },
      create: {
        userId: u.id,
        groupId: mainGroup.id,
        role: u.role === "ADMIN" ? "OWNER" : "MEMBER",
        rulesAccepted: true,
      },
    });
  }

  // Create default channels for the main community
  const generalChannel = await prisma.channel.upsert({
    where: { id: "general" },
    update: {},
    create: {
      id: "general",
      name: "Общий",
      type: "TEXT",
      icon: "💬",
      groupId: mainGroup.id,
    },
  });

  await prisma.channel.upsert({
    where: { id: "news" },
    update: { type: "NEWS" },
    create: {
      id: "news",
      name: "Объявления",
      type: "NEWS",
      icon: "📢",
      groupId: mainGroup.id,
    },
  });

  // 4 voice channels
  for (let i = 1; i <= 4; i++) {
    await prisma.channel.upsert({
      where: { id: `voice-${i}` },
      update: {},
      create: {
        id: `voice-${i}`,
        name: `Голосовой ${i}`,
        type: "VOICE",
        icon: "🎙️",
        groupId: mainGroup.id,
      },
    });
  }

  await prisma.channelMember.upsert({
    where: { userId_channelId: { userId: admin.id, channelId: generalChannel.id } },
    update: {},
    create: {
      userId: admin.id,
      channelId: generalChannel.id,
      role: "ADMIN",
    },
  });

  // Create a default invite for the group
  await prisma.invite.upsert({
    where: { code: "trioz-welcome" },
    update: {},
    create: {
      code: "trioz-welcome",
      groupId: mainGroup.id,
      createdBy: admin.id,
      maxUses: 0,
    },
  });

  const services = [
    { title: "Честный Знак", description: "Подключение, интеграция и помощь в работе с системой маркировки Честный Знак. Полное сопровождение от регистрации до настройки процессов.", icon: "✅", order: 1 },
    { title: "CRM Интеграция", description: "Аналитика, подключение, интеграция и помощь в работах с CRM Bitrix, СБИС, МойСклад, Nethouse, 1С и другими системами.", icon: "📊", order: 2 },
    { title: "ИИ-Помощники", description: "Подключение, интеграция и помощь в работе с различными открытыми ИИ-помощниками для вашего бизнеса.", icon: "🤖", order: 3 },
    { title: "ИИ-Автоматизация", description: "Разработка приложений автоматизации бизнес-процессов с помощью искусственного интеллекта.", icon: "⚡", order: 4 },
    { title: "Облачные хранилища", description: "Создание и настройка облачных хранилищ под индивидуальные нужды вашего бизнеса.", icon: "☁️", order: 5 },
    { title: "Создание сайтов", description: "Разработка современных веб-сайтов под нужды бизнеса с адаптивным дизайном и SEO-оптимизацией.", icon: "🌐", order: 6 },
    { title: "Сопровождение TZ.Ent", description: "Персональное сопровождение компании сотрудником TZ.Ent для помощи в любом направлении деятельности.", icon: "👤", order: 7 },
    { title: "Обслуживание сайтов", description: "Профессиональное обслуживание, изменение и настройка уже готовых сайтов. SEO-оптимизация.", icon: "🔧", order: 8 },
    { title: "Настройка систем", description: "Обслуживание, изменение и настройка ваших информационных систем и инфраструктуры.", icon: "⚙️", order: 9 },
    { title: "Рекламные кампании", description: "Создание и управление рекламными кампаниями для продвижения вашего бизнеса.", icon: "📣", order: 10 },
    { title: "Телеграм-боты", description: "Разработка Telegram-ботов любой сложности для автоматизации бизнес-процессов и взаимодействия с клиентами.", icon: "🤖", order: 11 },
  ];

  for (const service of services) {
    await prisma.service.upsert({
      where: { id: `service-${service.order}` },
      update: service,
      create: { id: `service-${service.order}`, ...service },
    });
  }

  await prisma.article.upsert({
    where: { slug: "welcome-to-trioz" },
    update: {},
    create: {
      title: "Добро пожаловать в мир T.Р.И.О.Z",
      slug: "welcome-to-trioz",
      content: `# Добро пожаловать в мир T.Р.И.О.Z\n\nT.Р.И.О.Z — это масштабная вселенная, объединяющая множество проектов и направлений. От глобальной MMORPG до настольных игр, от книг до IT-услуг для бизнеса.\n\n## Наши направления\n\n- **Осколок Измерений** — компьютерные и мобильные игры\n- **Перо Измерений** — книги и настольные игры\n- **TZ.Connect** — коммуникационная платформа\n- **TZ.Library** — база знаний и лор вселенной\n\nПрисоединяйтесь к нам и станьте частью этого мира!`,
      category: "Общее",
      tags: "welcome,trioz,introduction",
      published: true,
    },
  });

  await prisma.article.upsert({
    where: { slug: "pero-izmereniy-put-k-pustote" },
    update: {},
    create: {
      title: "Перо Измерений: Путь к Пустоте",
      slug: "pero-izmereniy-put-k-pustote",
      content: `# Перо Измерений: Путь к Пустоте\n\nКнига находится в процессе редактирования. Это первая книга серии «Перо Измерений», погружающая читателя в глубины вселенной T.Р.И.О.Z.\n\n## О чём книга\n\nИстория рассказывает о путешествии через измерения, где каждый мир хранит свои тайны и опасности. Главный герой должен найти путь через пустоту, чтобы спасти реальность от разрушения.\n\n*Статус: В процессе редактирования*`,
      category: "Книги",
      tags: "book,pero,dimensions",
      published: true,
    },
  });

  await prisma.article.upsert({
    where: { slug: "velderan-board-game" },
    update: {},
    create: {
      title: "Настольная Игра: Перо Измерений — Вельд'Эран",
      slug: "velderan-board-game",
      content: `# Настольная Игра: Перо Измерений — Вельд'Эран\n\nНастольная игра «Вельд'Эран» — это стратегическая игра, действие которой разворачивается во вселенной T.Р.И.О.Z.\n\n## Особенности\n\n- Развивает стратегическое мышление\n- Уникальная механика измерений\n- Погружение в лор вселенной\n- Для 2-6 игроков\n\n*Задача данного направления — создание легкодоступных для людей развлекательных товаров, направленных на развитие мышления.*`,
      category: "Игры",
      tags: "boardgame,velderan,pero",
      published: true,
    },
  });

  const windows = [
    { windowKey: "trioz", title: 'Проекты Т.Р.И.О."Z"', subtitle: "MMORPG • Стратегии • Онлайн", description: "Глобальная MMORPG с элементами стратегии и бесконечным миром", href: "/projects", accentColor: "#ff4444", backgroundType: "gradient", gradientFrom: "#1a0000", gradientTo: "#0a0a0f", order: 0 },
    { windowKey: "pero", title: "Перо Измерений", subtitle: "Книги • Настольные игры • Офлайн", description: "Развлекательные товары для развития мышления", href: "/pero", accentColor: "#8b5cf6", backgroundType: "gradient", gradientFrom: "#1a002e", gradientTo: "#0a0a0f", order: 1 },
    { windowKey: "connect", title: "TZ.Connect", subtitle: "Связь • IT-услуги • Бизнес", description: "Коммуникационная платформа и IT-решения", href: "/connect", accentColor: "#00f0ff", backgroundType: "gradient", gradientFrom: "#001a1f", gradientTo: "#0a0a0f", order: 2 },
    { windowKey: "library", title: "TZ.Library", subtitle: "Лор • Вики • История", description: "Хранилище знаний и лора вселенной", href: "/library", accentColor: "#10b981", backgroundType: "gradient", gradientFrom: "#001a0e", gradientTo: "#0a0a0f", order: 3 },
  ];

  for (const win of windows) {
    await prisma.windowConfig.upsert({
      where: { windowKey: win.windowKey },
      update: win,
      create: win,
    });
  }

  console.log("Seed completed successfully!");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
