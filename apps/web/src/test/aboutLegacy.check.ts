/**
 * Проверки страницы /about в архитектуре прежней версии проекта:
 * заголовок + четыре карточки направлений + аккордеон соглашения.
 *
 * Запуск: npx tsx src/test/aboutLegacy.check.ts
 */

import { existsSync, readFileSync } from "node:fs";
import { ABOUT_DEFAULTS, ABOUT_SECTIONS, aboutKeys } from "../lib/about";
import { LEGAL_DEFAULTS, LEGAL_SECTIONS, legalKeys } from "../lib/legal";

let failures = 0;

function check(name: string, fn: () => void) {
  try {
    fn();
    console.log("  ok   " + name);
  } catch (error) {
    failures += 1;
    console.log("  FAIL " + name);
    console.log("       " + (error as Error).message);
  }
}

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

const page = readFileSync("src/app/about/page.tsx", "utf8");
const adminAbout = readFileSync("src/app/admin/about/page.tsx", "utf8");
const adminLegal = readFileSync("src/app/admin/legal/page.tsx", "utf8");
const adminContent = readFileSync("src/app/admin/content/page.tsx", "utf8");

console.log("\n\u0421\u0442\u0440\u0430\u043d\u0438\u0446\u0430 /about \u2014 \u0430\u0440\u0445\u0438\u0442\u0435\u043a\u0442\u0443\u0440\u0430 \u043f\u0440\u0435\u0436\u043d\u0435\u0439 \u0432\u0435\u0440\u0441\u0438\u0438\n");

check("\u0447\u0435\u0442\u044b\u0440\u0435 \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u044f \u043d\u0430 \u043c\u0435\u0441\u0442\u0435", () => {
  assert(ABOUT_SECTIONS.length === 4, "\u043a\u0430\u0440\u0442\u043e\u0447\u0435\u043a \u043d\u0435 \u0447\u0435\u0442\u044b\u0440\u0435: " + ABOUT_SECTIONS.length);
  const keys = ABOUT_SECTIONS.map((s) => s.key).join(",");
  assert(keys === "trioz,pero,connect,library", "\u0438\u0437\u043c\u0435\u043d\u0451\u043d \u0441\u043e\u0441\u0442\u0430\u0432 \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0439: " + keys);
  for (const section of ABOUT_SECTIONS) {
    assert(section.title.trim().length > 0, "\u043f\u0443\u0441\u0442\u043e\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a: " + section.key);
    assert(section.description.trim().length > 40, "\u043a\u043e\u0440\u043e\u0442\u043a\u043e\u0435 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u0435: " + section.key);
    assert(section.href.startsWith("/"), "\u0441\u043b\u043e\u043c\u0430\u043d\u0430 \u0441\u0441\u044b\u043b\u043a\u0430: " + section.key);
    assert(/^#[0-9a-f]{6}$/i.test(section.color), "\u0441\u043b\u043e\u043c\u0430\u043d \u0446\u0432\u0435\u0442: " + section.key);
  }
});

check("\u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a \u0438 \u043f\u043e\u0434\u043f\u0438\u0441\u044c \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u0437\u0430\u0434\u0430\u043d\u044b \u0432 \u043a\u043e\u0434\u0435", () => {
  assert(ABOUT_DEFAULTS.title.trim().length > 0, "\u043d\u0435\u0442 \u0437\u0430\u0433\u043b\u0430\u0432\u0438\u044f");
  assert(ABOUT_DEFAULTS.subtitle.length > 40, "\u043d\u0435\u0442 \u043f\u043e\u0434\u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0430");
  assert(ABOUT_DEFAULTS.eyebrow.trim().length > 0, "\u043d\u0435\u0442 \u043d\u0430\u0434\u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0430");
  assert(ABOUT_DEFAULTS.footer.trim().length > 0, "\u043d\u0435\u0442 \u043f\u043e\u0434\u043f\u0438\u0441\u0438");
});

check("\u0432\u043e\u0441\u0435\u043c\u044c \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f \u0441 \u0442\u0435\u043a\u0441\u0442\u043e\u043c", () => {
  assert(LEGAL_SECTIONS.length === 8, "\u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u043d\u0435 \u0432\u043e\u0441\u0435\u043c\u044c: " + LEGAL_SECTIONS.length);
  let total = 0;
  LEGAL_SECTIONS.forEach((section, i) => {
    assert(section.title.trim().length > 0, "\u043f\u0443\u0441\u0442\u043e\u0439 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043e\u043a \u0440\u0430\u0437\u0434\u0435\u043b\u0430 " + (i + 1));
    assert(section.content.trim().length > 200, "\u0441\u043b\u0438\u0448\u043a\u043e\u043c \u043a\u043e\u0440\u043e\u0442\u043a\u0438\u0439 \u0440\u0430\u0437\u0434\u0435\u043b " + (i + 1));
    total += section.content.length;
  });
  assert(total > 6000, "\u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435 \u043f\u043e\u0434\u043e\u0437\u0440\u0438\u0442\u0435\u043b\u044c\u043d\u043e \u043a\u043e\u0440\u043e\u0442\u043a\u043e\u0435: " + total);
  console.log("       \u043e\u0431\u044a\u0451\u043c \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f: " + total + " \u0441\u0438\u043c\u0432\u043e\u043b\u043e\u0432");
  assert(LEGAL_DEFAULTS.heading.trim().length > 0, "\u043d\u0435\u0442 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0430 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f");
});

check("\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u0441\u043e\u0431\u0440\u0430\u043d\u0430 \u043a\u0430\u043a \u0432 \u043f\u0440\u0435\u0436\u043d\u0435\u0439 \u0432\u0435\u0440\u0441\u0438\u0438", () => {
  assert(page.includes("ABOUT_SECTIONS.map"), "\u043a\u0430\u0440\u0442\u043e\u0447\u043a\u0438 \u043d\u0435 \u0440\u0438\u0441\u0443\u044e\u0442\u0441\u044f");
  assert(page.includes("<LegalSection />"), "\u0430\u043a\u043a\u043e\u0440\u0434\u0435\u043e\u043d \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u044f \u043f\u0440\u043e\u043f\u0430\u043b");
  assert(page.includes("legalKeys.sectionContent"), "\u0442\u0435\u043a\u0441\u0442 \u0440\u0430\u0437\u0434\u0435\u043b\u043e\u0432 \u043d\u0435 \u043f\u043e\u0434\u0442\u044f\u0433\u0438\u0432\u0430\u0435\u0442\u0441\u044f \u0438\u0437 \u0430\u0434\u043c\u0438\u043d\u043a\u0438");
  assert(page.includes('fetch("/api/site-content")'), "\u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0430 \u043d\u0435 \u0447\u0438\u0442\u0430\u0435\u0442 \u0442\u0435\u043a\u0441\u0442\u044b \u0441\u0430\u0439\u0442\u0430");
  assert(page.includes("CosmicBackground"), "\u0444\u043e\u043d \u043f\u0440\u043e\u043f\u0430\u043b");
  assert(page.includes("ProjectGlyph"), "\u0433\u043b\u0438\u0444\u044b \u043d\u0430\u043f\u0440\u0430\u0432\u043b\u0435\u043d\u0438\u0439 \u043f\u0440\u043e\u043f\u0430\u043b\u0438");
  assert(page.includes("DesktopDownload"), "\u0431\u043b\u043e\u043a \u0437\u0430\u0433\u0440\u0443\u0437\u043a\u0438 \u043f\u0440\u043e\u043f\u0430\u043b");
});

check("\u0431\u043b\u043e\u0447\u043d\u043e\u0439 \u0441\u0438\u0441\u0442\u0435\u043c\u044b \u0431\u043e\u043b\u044c\u0448\u0435 \u043d\u0435\u0442", () => {
  const removed = [
    "src/lib/aboutBlocks.ts",
    "src/lib/blockData.ts",
    "src/components/about/AboutPageClient.tsx",
    "src/components/about/LegacyAboutSections.tsx",
    "src/components/about/LegalFooter.tsx",
    "src/components/about/useLegalContent.ts",
    "src/components/admin/MediaUploadField.tsx",
    "src/app/api/about-blocks/route.ts",
    "src/app/api/admin/about-blocks/route.ts",
    "src/app/api/about-media/route.ts",
    "src/app/api/about-apps-upload/route.ts",
    "src/app/api/admin/about-upload/route.ts",
  ];
  for (const file of removed) {
    assert(!existsSync(file), "\u0444\u0430\u0439\u043b \u043e\u0441\u0442\u0430\u043b\u0441\u044f: " + file);
  }
  for (const [name, code] of [
    ["about/page.tsx", page],
    ["admin/about/page.tsx", adminAbout],
    ["admin/legal/page.tsx", adminLegal],
    ["admin/content/page.tsx", adminContent],
  ] as Array<[string, string]>) {
    assert(!code.includes("aboutBlocks"), "\u043e\u0441\u0442\u0430\u043b\u0430\u0441\u044c \u0441\u0441\u044b\u043b\u043a\u0430 \u043d\u0430 aboutBlocks \u0432 " + name);
    assert(!code.includes("about-blocks"), "\u043e\u0441\u0442\u0430\u043b\u0441\u044f \u0437\u0430\u043f\u0440\u043e\u0441 \u043a /api/about-blocks \u0432 " + name);
    assert(!code.includes("LegalFooter"), "\u043e\u0441\u0442\u0430\u043b\u0441\u044f \u043f\u0440\u0430\u0432\u043e\u0432\u043e\u0439 \u043f\u043e\u0434\u0432\u0430\u043b \u0432 " + name);
  }
  const schema = readFileSync("prisma/schema.prisma", "utf8");
  assert(!schema.includes("model AboutBlock"), "\u043c\u043e\u0434\u0435\u043b\u044c AboutBlock \u043e\u0441\u0442\u0430\u043b\u0430\u0441\u044c \u0432 \u0441\u0445\u0435\u043c\u0435");
  assert(
    existsSync("prisma/migrations/20261002000000_drop_about_blocks/migration.sql"),
    "\u043d\u0435\u0442 \u043c\u0438\u0433\u0440\u0430\u0446\u0438\u0438 \u0443\u0434\u0430\u043b\u0435\u043d\u0438\u044f \u0442\u0430\u0431\u043b\u0438\u0446\u044b",
  );
});

check("\u0442\u0435\u043a\u0441\u0442\u044b \u043f\u0440\u0430\u0432\u044f\u0442\u0441\u044f \u0432 \u0434\u0432\u0443\u0445 \u0440\u0430\u0437\u0434\u0435\u043b\u0430\u0445 \u0430\u0434\u043c\u0438\u043d\u043a\u0438", () => {
  assert(adminAbout.includes("aboutKeys"), "/admin/about \u043d\u0435 \u043f\u0440\u0430\u0432\u0438\u0442 \u0442\u0435\u043a\u0441\u0442\u044b \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b");
  assert(adminAbout.includes("/api/site-content"), "/admin/about \u043d\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u0442 \u0442\u0435\u043a\u0441\u0442\u044b");
  assert(adminLegal.includes("legalKeys") || adminLegal.includes("legal."), "/admin/legal \u043d\u0435 \u043f\u0440\u0430\u0432\u0438\u0442 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435");
  assert(adminLegal.includes("/api/site-content"), "/admin/legal \u043d\u0435 \u0441\u043e\u0445\u0440\u0430\u043d\u044f\u0435\u0442 \u0441\u043e\u0433\u043b\u0430\u0448\u0435\u043d\u0438\u0435");
  assert(existsSync("src/app/api/site-content/route.ts"), "\u043f\u0440\u043e\u043f\u0430\u043b\u043e \u0445\u0440\u0430\u043d\u0438\u043b\u0438\u0449\u0435 \u0442\u0435\u043a\u0441\u0442\u043e\u0432");
  assert(adminContent.includes("/admin/about") && adminContent.includes("/admin/legal"), "\u0443\u043a\u0430\u0437\u0430\u0442\u0435\u043b\u044c \u043d\u0435 \u0432\u0435\u0434\u0451\u0442 \u0432 \u0434\u0432\u0430 \u0440\u0430\u0437\u0434\u0435\u043b\u0430");
});

check("\u043a\u043b\u044e\u0447\u0438 \u0430\u0434\u043c\u0438\u043d\u043a\u0438 \u0438 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u044b \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442", () => {
  assert(aboutKeys.sectionTitle("trioz") === "about.section.trioz.title", "\u0441\u0445\u0435\u043c\u0430 \u043a\u043b\u044e\u0447\u0435\u0439 \u0441\u0435\u043a\u0446\u0438\u0439 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0430\u0441\u044c");
  assert(aboutKeys.sectionDesc("trioz") === "about.section.trioz", "\u043a\u043b\u044e\u0447 \u043e\u043f\u0438\u0441\u0430\u043d\u0438\u044f \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f");
  assert(legalKeys.sectionTitle(0) === "legal.section.1.title", "\u043a\u043b\u044e\u0447 \u0437\u0430\u0433\u043e\u043b\u043e\u0432\u043a\u0430 \u0440\u0430\u0437\u0434\u0435\u043b\u0430 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f");
  assert(legalKeys.sectionContent(7) === "legal.section.8.content", "\u043a\u043b\u044e\u0447 \u0442\u0435\u043a\u0441\u0442\u0430 \u0440\u0430\u0437\u0434\u0435\u043b\u0430 \u0438\u0437\u043c\u0435\u043d\u0438\u043b\u0441\u044f");
  for (const key of [aboutKeys.eyebrow, aboutKeys.title, aboutKeys.subtitle, aboutKeys.footer]) {
    assert(adminAbout.includes(key) || adminAbout.includes("aboutKeys"), "\u043a\u043b\u044e\u0447 \u043d\u0435 \u0440\u0435\u0434\u0430\u043a\u0442\u0438\u0440\u0443\u0435\u0442\u0441\u044f: " + key);
  }
});

check("\u043f\u0440\u043e\u043f\u0441\u044b \u0441\u043e\u0432\u043f\u0430\u0434\u0430\u044e\u0442 \u0441 \u0441\u0438\u0433\u043d\u0430\u0442\u0443\u0440\u0430\u043c\u0438 \u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442\u043e\u0432", () => {
  const glyph = readFileSync("src/components/about/ProjectGlyph.tsx", "utf8");
  const signature = /export default function ProjectGlyph\(\{([^}]*)\}/.exec(glyph);
  assert(signature !== null, "\u043d\u0435 \u0440\u0430\u0437\u043e\u0431\u0440\u0430\u043b\u0430\u0441\u044c \u0441\u0438\u0433\u043d\u0430\u0442\u0443\u0440\u0430 ProjectGlyph");
  const allowed = (signature as RegExpExecArray)[1].split(",").map((p) => p.trim()).filter(Boolean);
  const usage = /<ProjectGlyph([^/]*)\/>/.exec(page);
  assert(usage !== null, "ProjectGlyph \u043d\u0435 \u0438\u0441\u043f\u043e\u043b\u044c\u0437\u0443\u0435\u0442\u0441\u044f \u043d\u0430 \u0441\u0442\u0440\u0430\u043d\u0438\u0446\u0435");
  const passed = ((usage as RegExpExecArray)[1].match(/([a-zA-Z]+)=/g) ?? []).map((m) => m.replace("=", ""));
  assert(passed.includes("name"), "\u0433\u043b\u0438\u0444 \u043d\u0435 \u043f\u043e\u043b\u0443\u0447\u0430\u0435\u0442 \u043e\u0431\u044f\u0437\u0430\u0442\u0435\u043b\u044c\u043d\u044b\u0439 name");
  for (const prop of passed) {
    assert(allowed.includes(prop), "\u043a\u043e\u043c\u043f\u043e\u043d\u0435\u043d\u0442 \u043d\u0435 \u0437\u043d\u0430\u0435\u0442 \u043f\u0440\u043e\u043f\u0430 \u00ab" + prop + "\u00bb \u2014 tsc \u0443\u043f\u0430\u0434\u0451\u0442");
  }
});

console.log(
  failures === 0
    ? "\n\u0412\u0441\u0435 \u043f\u0440\u043e\u0432\u0435\u0440\u043a\u0438 \u043f\u0440\u043e\u0448\u043b\u0438.\n"
    : "\n\u041d\u0435 \u043f\u0440\u043e\u0448\u043b\u043e \u043f\u0440\u043e\u0432\u0435\u0440\u043e\u043a: " + failures + "\n",
);
process.exit(failures === 0 ? 0 : 1);
