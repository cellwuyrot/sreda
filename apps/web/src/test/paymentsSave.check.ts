/**
 * FIX-PAY-SAVE: страж полного цикла сохранения платёжных реквизитов.
 *
 * Проверяет те свойства кода, из-за отсутствия которых реквизиты терялись молча:
 * частичная запись без транзакции, безымянные 500 и форма, игнорирующая ошибки API.
 * Запуск: npx tsx src/test/paymentsSave.check.ts
 */
import { readFileSync } from "node:fs";

const route = readFileSync("src/app/api/admin/payments/route.ts", "utf8");
const page = readFileSync("src/app/admin/payments/page.tsx", "utf8");
const settings = readFileSync("src/lib/paymentSettings.ts", "utf8");
const encryption = readFileSync("src/lib/encryption.ts", "utf8");
const schema = readFileSync("prisma/schema.prisma", "utf8");

const REQUIRED_KEYS = [
  "bizpay_org_name", "bizpay_inn", "bizpay_kpp", "bizpay_bank", "bizpay_bik",
  "bizpay_account", "bizpay_corr_account", "bizpay_purpose",
  "bizpay_sbp_enabled", "bizpay_sbp_phone", "bizpay_sbp_bank", "bizpay_sbp_recipient",
  "bizpay_acquiring_enabled", "bizpay_acquiring_provider", "bizpay_acquiring_link",
  "bizpay_acquiring_merchant", "bizpay_acquiring_secret",
];

let failures = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log(`  ok   ${name}`); }
  catch (e) { failures++; console.log(`  FAIL ${name} / ${(e as Error).message}`); }
}
function assert(cond: unknown, msg: string) { if (!cond) throw new Error(msg); }

check("все бизнес-реквизиты объявлены и есть в форме", () => {
  for (const key of REQUIRED_KEYS) {
    assert(settings.includes(`"${key}"`), `${key} нет в paymentSettings.ts`);
    assert(settings.includes(`${key}:`), `${key} нет в PAYMENT_DEFAULTS`);
    assert(page.includes(key), `${key} нет в форме админки`);
  }
});

check("запись идёт одной транзакцией без частичных сохранений", () => {
  assert(route.includes("prisma.$transaction"), "нет prisma.$transaction");
  assert(!/await prisma\.siteConfig\.upsert/.test(route), "остался построчный await upsert");
});

check("каждый отказ API несёт текст ошибки", () => {
  assert(route.includes("function fail("), "нет единого ответа об ошибке");
  assert(route.includes("catch (e)"), "исключения не перехватываются");
  assert(route.includes("errorText(e)"), "текст исключения не попадает в ответ");
  assert(route.includes("ENCRYPTION_SECRET"), "нет проверки ключа шифрования");
});

check("шифрование секретов на месте", () => {
  assert(route.includes("encodePaymentValue"), "секрет пишется минуя шифрование");
  assert(/PAYMENT_SECRET_KEYS.includes\(key\) && value/.test(settings), "encodePaymentValue больше не шифрует");
  assert(encryption.includes("aes-256-gcm"), "алгоритм шифрования изменён");
  assert(encryption.includes("hasEncryptionSecret"), "нет проверки наличия ключа");
  assert(route.includes("\u2022\u2022\u2022"), "секрет больше не маскируется наружу");
});

check("пустой секрет не затирает сохранённый ключ", () => {
  assert(route.includes('if (value === "") continue;'), "пустой секрет запишется в базу");
  assert(route.includes("_clear`]"), "нет явной очистки секрета");
});

check("есть контрольное чтение после записи", () => {
  assert(route.includes("readPaymentConfig()"), "после записи нет сверки с базой");
  assert(route.includes("mismatched"), "расхождения с базой не проверяются");
});

check("авторизация различает 401 и 403", () => {
  assert(route.includes("401"), "нет 401 для истекшей сессии");
  assert(route.includes("403"), "нет 403 для не-админа");
  assert(route.includes('session.user.role !== "ADMIN"'), "проверка роли потеряна");
});

check("валидация входящих данных", () => {
  assert(route.includes("MAX_VALUE_LENGTH"), "нет предела длины");
  assert(route.includes("400"), "нет ответа 400 на плохой запрос");
  assert(route.includes("req.json().catch"), "битый JSON уронит роут");
});

check("чтение не кэшируется", () => {
  assert(route.includes('export const dynamic = "force-dynamic"'), "нет force-dynamic в роуте");
  assert(page.includes('cache: "no-store"'), "форма читает из кэша");
});

check("форма показывает реальную ошибку API", () => {
  assert(page.includes("if (!res.ok)"), "ответы 4xx/5xx не разбираются");
  assert(page.includes("setError(payload?.error"), "текст ошибки API не показывается");
  assert(page.includes('role="alert"') && page.includes("{error}"), "нет блока с ошибкой");
  assert(page.indexOf("setSaved(true)") > page.indexOf("const check = await fetch"), "«Сохранено» показывается до проверки");
});

check("хранилище SiteConfig не изменено", () => {
  assert(/model SiteConfig \{[\s\S]*?key\s+String\s+@unique/.test(schema), "SiteConfig.key больше не уникален — upsert перестанет работать");
});

console.log(`\nНе прошло проверок: ${failures}`);
process.exit(failures === 0 ? 0 : 1);
