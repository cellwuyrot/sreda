/*
 * PAYLINK: проверки сборки на самом проекте.
 *
 * Сценарные тесты проверяют логику, а этот файл — что логика вообще подключена:
 * ключи настроек сохраняются, схема и миграция есть, вкладки в админке отрисованы,
 * кнопка оплаты стоит у обеих подписок. Запуск: npx tsx src/test/paymentLinks.check.ts
 */
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
let passed = 0;
const failures: string[] = [];

function ok(name: string, cond: boolean, extra?: string) {
  if (cond) {
    passed += 1;
    console.log(`PASS ${name}`);
  } else {
    failures.push(name);
    console.log(`FAIL ${name}${extra ? ` :: ${extra}` : ""}`);
  }
}

function read(rel: string): string {
  const path = join(root, rel);
  if (!existsSync(path)) return "";
  return readFileSync(path, "utf8");
}

/** Комментарии вырезаются: упоминание в комментарии — не работающий код. */
function code(rel: string): string {
  return read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

// ── 1. Настройки сохраняются и шифруются ────────────────────────────
const settings = code("src/lib/paymentSettings.ts");
const vpnKeys = [
  "vpnpay_same_as_premium",
  "vpn_price_month",
  "vpn_currency",
  "vpnpay_sbp_enabled",
  "vpnpay_sbp_phone",
  "vpnpay_sbp_bank",
  "vpnpay_sbp_recipient",
  "vpnpay_sbp_comment",
  "vpnpay_acquiring_enabled",
  "vpnpay_acquiring_provider",
  "vpnpay_acquiring_link",
  "vpnpay_acquiring_merchant",
  "vpnpay_acquiring_secret",
  "vpnpay_acquiring_comment",
];
const payLinkKeys = [
  "paylink_enabled",
  "paylink_auto_activate",
  "paylink_reserve_minutes",
  "paylink_instruction",
];
for (const key of [...vpnKeys, ...payLinkKeys]) {
  ok(`настройка ${key} сохраняется`, settings.includes(`"${key}"`));
}
ok("секрет эквайринга VPN шифруется", /PAYMENT_SECRET_KEYS[\s\S]{0,300}vpnpay_acquiring_secret/.test(settings));
ok("есть чтение способов оплаты VPN", settings.includes("readVpnPaymentMethods"));
ok("VPN подхватывает реквизиты Premium при «как у Premium»", settings.includes("vpnpay_same_as_premium"));

// ── 2. База данных ──────────────────────────────────────────────────────
const schema = read("prisma/schema.prisma");
ok("в схеме есть модель PaymentLink", /model\s+PaymentLink\s*\{/.test(schema));
const model = schema.slice(schema.indexOf("model PaymentLink"));
ok("адрес ссылки уникален — одна ссылка не ложится дважды", /url\s+String\s+@unique/.test(model.slice(0, 2000)));
for (const field of ["reservedById", "reservationExpiresAt", "paidReportedAt", "usedById", "confirmedById", "subscriptionId", "payerReference"]) {
  ok(`в модели есть поле ${field}`, model.slice(0, 3000).includes(field));
}
const migrations = existsSync(join(root, "prisma/migrations"))
  ? readdirSync(join(root, "prisma/migrations"))
  : [];
const migrationDir = migrations.find((name) => name.includes("payment_links"));
ok("миграция для таблицы ссылок добавлена", !!migrationDir, migrations.join(", "));
if (migrationDir) {
  const sql = read(`prisma/migrations/${migrationDir}/migration.sql`);
  ok("миграция создаёт таблицу", sql.includes('CREATE TABLE IF NOT EXISTS "PaymentLink"'));
  ok("миграция ставит уникальный индекс на адрес", sql.includes("PaymentLink_url_key"));
  ok("повторный прогон миграции безопасен", sql.includes("IF NOT EXISTS") && sql.includes("duplicate_object"));
}

// ── 3. Логика ссылок ───────────────────────────────────────────────────
const links = code("src/lib/paymentLinks.ts");
const linksAll = links + code("src/lib/paymentLinkKinds.ts");
ok("цикл состояний описан", ["FREE", "RESERVED", "AWAITING", "USED", "DISABLED"].every((s) => linksAll.includes(`"${s}"`)));
ok("ссылка захватывается условным обновлением", /updateMany\([\s\S]{0,200}status: "FREE"/.test(links));
ok("подписка и смена статуса идут одной транзакцией", links.includes("$transaction(async (tx)"));
ok("Premium привязывается к профилю", links.includes("isPremium: true"));
ok("VPN привязывается к профилю", links.includes("vpnAccess: true") && links.includes("vpnAccessUntil"));
ok("кэш авторизации сбрасывается", links.includes("invalidateUserAuthCache"));
ok("клиент узнаёт об обновлении", links.includes("account-premium-updated") && links.includes("account-vpn-updated"));
ok("заявленная оплата не сгорает по таймеру", /status: "RESERVED", reservationExpiresAt/.test(links));

// ── 4. Админские и клиентские маршруты ─────────────────────────────
const adminRoute = code("src/app/api/admin/payment-links/route.ts");
ok("админский маршрут есть", adminRoute.length > 0);
for (const method of ["export async function GET", "export async function POST", "export async function PATCH", "export async function DELETE"]) {
  ok(`админский маршрут: ${method.split(" ").pop()}`, adminRoute.includes(method));
}
for (const action of ["confirm", "release", "disable", "enable"]) {
  ok(`админское действие ${action}`, adminRoute.includes(`"${action}"`));
}
ok("чужие в админский маршрут не пройдут", adminRoute.includes("ADMIN") && adminRoute.includes("403"));
ok("дубли ссылок при загрузке не создаются", adminRoute.includes("skipDuplicates"));

const userRoute = code("src/app/api/payments/links/route.ts");
ok("клиентский маршрут есть", userRoute.length > 0);
ok("клиент может взять ссылку", userRoute.includes('"reserve"'));
ok("клиент может отметить оплату", userRoute.includes('"paid"'));
ok("есть защита от частых нажатий", userRoute.includes("rateLimit"));
ok("выключенная настройка закрывает оплату", userRoute.includes("paylink_enabled") || userRoute.includes("enabled"));
ok("режим автовыдачи учитывается", userRoute.includes("paylink_auto_activate") || userRoute.includes("autoActivate"));
ok(
  "оба типа подписки обслуживаются",
  userRoute.includes("isPaymentLinkKind") &&
    userRoute.includes("readVpnPaymentMethods") &&
    userRoute.includes("readPublicPaymentMethods"),
);

// ── 5. Админка: вкладки ────────────────────────────────────────────────
const adminPage = code("src/app/admin/payments/page.tsx");
ok("вкладка второй подписки есть", adminPage.includes('label: "Ускоренный интернет"'));
ok("вкладка оплаты по ссылке есть", adminPage.includes('label: "Оплата по ссылке"'));
ok("вкладки отрисовываются", adminPage.includes('tab === "vpn"') && adminPage.includes('tab === "paylink"'));
ok("управление пулом ссылок встроено", adminPage.includes("<PaymentLinkManager />"));
for (const key of ["vpn_price_month", "vpnpay_sbp_phone", "vpnpay_acquiring_link", "paylink_reserve_minutes", "paylink_auto_activate"]) {
  ok(`в админке есть поле ${key}`, adminPage.includes(key));
}
ok("секрет VPN не показывается открытом текстом", adminPage.includes("vpnSecretSet") && /type="password"[\s\S]{0,200}vpnpay_acquiring_secret/.test(adminPage));
const manager = code("src/components/admin/PaymentLinkManager.tsx");
ok("в пуле можно загружать сразу несколько ссылок", manager.includes("textarea"));
ok("в пуле видны заявки на подтверждение", manager.includes("AWAITING"));
ok("пул предупреждает об исчерпании ссылок", manager.includes("stats.free"));

/* Сборка падала из-за того, что клиентский компонент тянул серверный модуль,
   а тот через prisma/auth — ioredis с узловыми net/tls/dns. Сторожим границу. */
const kinds = code("src/lib/paymentLinkKinds.ts");
ok("общая часть выделена в отдельный модуль", kinds.length > 0);
ok(
  "общая часть не тянет серверные зависимости",
  !["@/lib/prisma", "@/lib/auth", "@/lib/rateLimit", "@/lib/socketEmit", "ioredis"].some((dep) =>
    kinds.includes(dep),
  ),
);
ok("серверный модуль по-прежнему отдаёт общую часть", links.includes('export * from "@/lib/paymentLinkKinds"'));
for (const rel of [
  "src/components/admin/PaymentLinkManager.tsx",
  "src/components/premium/PaymentLinkCheckout.tsx",
]) {
  const source = code(rel);
  ok(`клиентский компонент не тянет серверный модуль: ${rel.split("/").pop()}`,
    !source.includes('from "@/lib/paymentLinks"') &&
      !["@/lib/prisma", "@/lib/auth", "@/lib/rateLimit"].some((dep) => source.includes(dep)),
  );
}

// ── 6. Настройки профиля: кнопка у обеих подписок ────────────────────
const settingsPage = code("src/app/settings/page.tsx");
ok("компонент оплаты подключён в настройках", settingsPage.includes("PaymentLinkCheckout"));
ok("кнопка есть у Premium", settingsPage.includes('<PaymentLinkCheckout kind="PREMIUM" />'));
ok("кнопка есть у Ускоренного интернета", settingsPage.includes('<PaymentLinkCheckout kind="VPN" />'));
const checkout = code("src/components/premium/PaymentLinkCheckout.tsx");
ok("компонент оплаты создан", checkout.length > 0);
ok("есть кнопка получения ссылки", checkout.includes('"reserve"'));
ok("есть кнопка «Я оплатил»", checkout.includes('"paid"'));
ok("блок скрывается, пока оплата по ссылке выключена", checkout.includes("!data.enabled"));
ok("ошибки API показываются пользователю", checkout.includes('role="alert"'));
ok("статус ожидания подтверждения объяснён", checkout.includes("AWAITING"));

console.log(`${String.fromCharCode(10)}Итого: пройдено ${passed}, провалено ${failures.length}`);
if (failures.length) {
  console.log(`Провалы: ${failures.join("; ")}`);
  process.exit(1);
}
