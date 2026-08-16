import type { ReactNode } from "react";
import type { Attachment } from "./messageTypes";
import { TriozText } from "@/components/ui/TriozEmoji";
import CodeBlock from "./CodeBlock";


/* FIX-TAGMENTION: решётка в сообщениях исторически означала переход в канал.
   Теперь ею же упоминают теги группы (#тестер). Разбор неоднозначности — по
   фактическому списку тегов сообщества: если имя совпало с тегом, рисуем
   цветную плашку упоминания, иначе прежняя ссылка на канал. Карта передаётся
   снаружи (MessageArea) и должна быть стабильной по ссылке — строки списка
   мемоизированы. */
export interface RoleTag { name: string; color: string }
export interface RenderOptions {
  /** Ключ — имя тега в нижнем регистре. */
  roleTags?: Map<string, RoleTag>;
  /**
   * Свои эмодзи сообщества: имя в нижнем регистре → адрес картинки. Токен
   * `:name:` становится картинкой только если имя есть в этой карте, иначе
   * остаётся текстом: набор принадлежит сообществу, и в личной переписке или в
   * чужом сообществе то же `:name:` картинкой быть не должно.
   *
   * Карта приходит сверху (MessageArea → MessageBody → сюда) по той же причине,
   * что и теги: модульная переменная-одиночка не пережила бы серверный рендер и
   * давала бы гонки между двумя открытыми сообществами.
   */
  emoji?: Map<string, string>;
}

/**
 * Блок кода: ```язык (необязательно) и перевод строки, дальше сам код до
 * закрывающих кавычек. Незакрытый блок кодом не считается — иначе одна тройная
 * кавычка превращала бы в код всё, что человек напишет дальше.
 */
const CODE_FENCE = /```([A-Za-z0-9+#._-]{0,20})?[ \t]*\r?\n?([\s\S]*?)```/g;

/**
 * Разметка сообщения. Сначала выделяются блоки кода, и только остальной текст
 * разбирается на ссылки, выделения и упоминания: внутри кода звёздочки, решётки
 * и собачки — это код, а не разметка.
 *
 * Раньше блоков не было вовсе: знали только `короткий код` внутри строки, и
 * присланная программа приезжала обычным текстом — отступы съедала вёрстка,
 * длинные строки переносились по словам, звёздочки в коде превращались в курсив.
 */
export function renderContent(text: string, options?: RenderOptions): ReactNode {
  if (!text.includes("```")) return renderBlocks(text, options);

  CODE_FENCE.lastIndex = 0;
  const blocks: ReactNode[] = [];
  let cursor = 0;
  let blockKey = 0;
  let fence: RegExpExecArray | null;

  while ((fence = CODE_FENCE.exec(text)) !== null) {
    if (fence.index > cursor) {
      blocks.push(<span key={`t${blockKey++}`}>{renderBlocks(text.slice(cursor, fence.index), options)}</span>);
    }
    /* Последний перевод строки перед закрывающими кавычками — часть разметки, а
       не кода: иначе в конце блока висит пустая строка. */
    blocks.push(
      <CodeBlock key={`c${blockKey++}`} lang={fence[1] || undefined} code={fence[2].replace(/\r?\n$/, "")} />,
    );
    cursor = fence.index + fence[0].length;
  }

  // Тройные кавычки были, но ни один блок не закрыт — разбираем как обычный текст.
  if (cursor === 0) return renderBlocks(text, options);
  if (cursor < text.length) {
    blocks.push(<span key={`t${blockKey++}`}>{renderBlocks(text.slice(cursor), options)}</span>);
  }
  return blocks;
}

/* POSTTABLE: таблицы в формате Markdown.
 *
 * Статьи в новостях часто сводятся к сравнительным таблицам — тарифы, сроки,
 * ответственные. Без разбора такие строки выводились частоколом палок и читались
 * хуже обычного списка.
 *
 * Разбор блочный и стоит НАД строчным: внутри ячеек остаётся вся обычная
 * разметка (жирный, ссылки, упоминания, свои эмодзи), потому что содержимое
 * ячейки уходит в renderInline. Обратный порядок невозможен: строчный разбор работает
 * одной регуляркой без понятия о соседних строках, а таблица — именно связка строк.
 *
 * Таблицей считается только то, что имеет строку-разделитель под шапкой. Без этого
 * условия любая строка с вертикальной чертой — а так пишут пути, регулярки и
 * альтернативы в переписке — превращалась бы в одноклеточную таблицу.
 */
const TABLE_DIVIDER = /^\s*\|?(?:\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?\s*$/;

/** Выровненность столбца из строки-разделителя: `:---`, `---:`, `:---:`. */
function columnAlign(cell: string): "left" | "center" | "right" {
  const value = cell.trim();
  const left = value.startsWith(":");
  const right = value.endsWith(":");
  if (left && right) return "center";
  if (right) return "right";
  return "left";
}

/* Экранированная черта `\|` — часть содержимого, а не граница ячейки. На время
   резки подменяем её символом из частной области Unicode: в тексте его не бывает. */
const PIPE_HOLDER = "\uE000";

function splitRow(line: string): string[] {
  const guarded = line.replace(/\\\|/g, PIPE_HOLDER);
  const trimmed = guarded.trim().replace(/^\|/, "").replace(/\|$/, "");
  return trimmed.split("|").map((cell) => cell.replace(new RegExp(PIPE_HOLDER, "g"), "|").trim());
}

function isTableRow(line: string): boolean {
  return line.replace(/\\\|/g, "").includes("|");
}

/** Стили таблицы берут переменные темы мессенджера — один вид в светлой и тёмной. */
function TableBlock({
  head,
  rows,
  align,
  options,
}: {
  head: string[];
  rows: string[][];
  align: Array<"left" | "center" | "right">;
  options?: RenderOptions;
}) {
  const columns = Math.max(head.length, ...rows.map((row) => row.length));
  const cells = (row: string[]) => {
    const padded = [...row];
    while (padded.length < columns) padded.push("");
    return padded;
  };

  return (
    /* На телефоне широкая таблица прокручивается внутри себя, а не растягивает
       всю ленту: иначе один пост с таблицей добавляет горизонтальную прокрутку
       всему экрану. */
    <div className="my-2 max-w-full overflow-x-auto rounded-xl border" style={{ borderColor: "var(--cn-border)" }}>
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr>
            {cells(head).map((cell, i) => (
              <th
                key={i}
                className="px-3 py-2 text-left font-semibold"
                style={{
                  textAlign: align[i] ?? "left",
                  background: "var(--cn-hover, rgba(127,127,127,0.08))",
                  borderBottom: "1px solid var(--cn-border)",
                  color: "var(--cn-text)",
                }}
              >
                {renderInline(cell, options)}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, r) => (
            <tr key={r}>
              {cells(row).map((cell, i) => (
                <td
                  key={i}
                  className="px-3 py-2 align-top"
                  style={{
                    textAlign: align[i] ?? "left",
                    borderTop: r === 0 ? undefined : "1px solid var(--cn-border)",
                    color: "var(--cn-text)",
                  }}
                >
                  {renderInline(cell, options)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Разбор отрезка текста на таблицы и всё остальное.
 *
 * Быстрый выход по отсутствию черты обязателен: через эту функцию проходит КАЖДОЕ
 * сообщение в ленте, а таблицы в переписке — редкость.
 */
function renderBlocks(text: string, options?: RenderOptions): ReactNode {
  if (!text.includes("|")) return renderInline(text, options);

  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let plain: string[] = [];
  let key = 0;

  const flushPlain = () => {
    if (plain.length === 0) return;
    out.push(<span key={`p${key++}`}>{renderInline(plain.join("\n"), options)}</span>);
    plain = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const head = lines[i];
    const divider = lines[i + 1];
    if (isTableRow(head) && divider !== undefined && TABLE_DIVIDER.test(divider)) {
      const align = splitRow(divider).map(columnAlign);
      const rows: string[][] = [];
      let j = i + 2;
      while (j < lines.length && isTableRow(lines[j]) && lines[j].trim() !== "") {
        rows.push(splitRow(lines[j]));
        j += 1;
      }
      flushPlain();
      out.push(
        <TableBlock key={`tb${key++}`} head={splitRow(head)} rows={rows} align={align} options={options} />,
      );
      /* Строка после таблицы обрабатывается со следующего шага цикла. */
      i = j - 1;
      continue;
    }
    plain.push(head);
  }

  flushPlain();
  /* Одна часть — отдаём её как есть: лишняя обёртка в переписке ни к чему. */
  return out.length === 1 ? out[0] : out;
}

// Render formatted content: links, **bold**, *italic*, `code`, - lists,
// ## подзаголовки, > цитаты, #channel mentions, @mentions
// FIX-LINKS: ссылками считаются и адреса без протокола, начинающиеся с «www.»
// (для href подставляется https://) — как в браузерных мессенджерах.
// Свой эмодзи сообщества — последняя ветвь `:name:`: он стоит после ссылок,
// иначе «https://…» разбирался бы по двоеточию в схеме.
/* POSTFMT: подзаголовок `## ` и цитата `> ` — построчные правила, добавлены для
   длинных постов новостей: страница текста без единого членения не читается, а
   чужая речь в ней неотличима от своей. В переписке они тоже работают — правило
   одно на чат и на ленту, иначе предпросмотр редактора врал бы.

   Порядок ветвей в переборе значим: `^## ` стоит ДО `#(\S+)`, потому что
   разбор идёт слева направо и упоминание канала съело бы вторую решётку,
   превратив каждый подзаголовок в ссылку на несуществующий канал «#».

   Ветви разбираются по НОМЕРАМ скобок, поэтому вставка правила в середину
   сдвигает номера всех последующих. Именованные группы избавили бы от этого,
   но они появились в ES2018, а цель сборки — ES2017 (см. tsconfig), и
   TypeScript их не пропускает. Добавляя правило, сверьте номера до конца
   функции: разъехавшийся номер не ошибка сборки, а молча пропавшая разметка. */
function renderInline(text: string, options?: RenderOptions): ReactNode {
    const parts: ReactNode[] = [];
    const regex = /((https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)|\*\*(.+?)\*\*|\*(.+?)\*|`(.+?)`|^- (.+)$|^## (.+)$|^> (.+)$|#(\S+)|@(everyone|[A-Za-z0-9_а-яА-ЯёЁ]+)|:([a-z0-9_]{2,32}):)/gm;
    let lastIndex = 0;
    let match;
    let key = 0;
    while ((match = regex.exec(text)) !== null) {
      if (match.index > lastIndex) parts.push(<TriozText key={key++} text={text.slice(lastIndex, match.index)} />);
      if (match[2]) {
        // Bare URL → blue clickable link that opens in a new tab. Trailing
        // punctuation is not treated as part of the link.
        const trimmed = match[2].replace(/[),.;:!?»"']+$/, "");
        const trail = match[2].slice(trimmed.length);
        // FIX-LINKS: «www.» без протокола открываем через https://
        const href = trimmed.startsWith("www.") ? `https://${trimmed}` : trimmed;
        parts.push(
          <a
            key={key++}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
            title={href}
            className="text-blue-500 dark:text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-600 dark:hover:text-blue-300 break-all cursor-pointer"
          >
            {trimmed}
          </a>
        );
        if (trail) parts.push(<TriozText key={key++} text={trail} />);
      }
      else if (match[3]) parts.push(<strong key={key++}><TriozText text={match[3]} /></strong>);
      else if (match[4]) parts.push(<em key={key++}><TriozText text={match[4]} /></em>);
      else if (match[5]) parts.push(<code key={key++} className="bg-neutral-200 dark:bg-white/10 px-1 rounded text-xs"><TriozText text={match[5]} /></code>);
      else if (match[6]) parts.push(<span key={key++} className="inline-flex items-start gap-1 align-top"><span className="text-violet-500 dark:text-cyan-400">•</span><span><TriozText text={match[6]} /></span></span>);
      /* POSTFMT: подзаголовок. Не заголовок страницы, а членение внутри текста,
         поэтому обычный элемент строки, а не h2: сообщение и пост живут внутри
         чужой вёрстки, и настоящий заголовок ломал бы структуру страницы для
         чтения с экрана. Цвет и начертание — те же, что у заголовков соседних
         панелей. */
      else if (match[7]) parts.push(<span key={key++} className="inline-block font-semibold text-[15px] leading-snug text-neutral-900 dark:text-white"><TriozText text={match[7]} /></span>);
      /* POSTFMT: цитата. Полоска слева — тот же приём и тот же цвет, что у
         строки «Ответ для…» над полем ввода: чужая речь в переписке уже
         обозначается так, и второй способ показывать то же самое запутывал бы. */
      else if (match[8]) parts.push(
        <span key={key++} className="inline-flex items-stretch gap-2 align-top">
          <span aria-hidden="true" className="w-0.5 shrink-0 rounded-full bg-violet-400 dark:bg-cyan-400" />
          <span className="italic text-neutral-600 dark:text-gray-300"><TriozText text={match[8]} /></span>
        </span>
      );
      else if (match[9]) {
        // FIX-HASHTAG: хештег канала теперь реально кликабелен: по клику шлём событие
        // tz-open-channel, а страница Connect находит канал и переключается на него.
        // Хвостовая пунктуация не считается частью имени канала.
        const clean = match[9].replace(/[),.;:!?»"']+$/, "");
        const trail = match[9].slice(clean.length);
        const tag = options?.roleTags?.get(clean.toLowerCase());
        if (tag) {
          // FIX-TAGMENTION: упоминание тега — плашка в цвете тега; носители
          // тега получают личное уведомление (см. POST /api/messages).
          parts.push(
            <span
              key={key++}
              title={`Тег сообщества «${tag.name}»`}
              className="px-1 rounded font-medium"
              style={{ backgroundColor: tag.color + "26", color: tag.color }}
            >
              #{tag.name}
            </span>
          );
          if (trail) parts.push(<TriozText key={key++} text={trail} />);
          lastIndex = match.index + match[0].length;
          continue;
        }
        parts.push(
          <span
            key={key++}
            onClick={(e) => {
              e.stopPropagation();
              window.dispatchEvent(new CustomEvent("tz-open-channel", { detail: clean }));
            }}
            title={`Перейти в канал #${clean}`}
            className="text-violet-500 dark:text-cyan-400 cursor-pointer hover:underline"
          >
            #{clean}
          </span>
        );
        if (trail) parts.push(<TriozText key={key++} text={trail} />);
      }
      else if (match[10]) {
        if (match[10] === "everyone") {
          parts.push(<span key={key++} className="bg-amber-500/20 text-amber-600 dark:text-amber-300 px-1 rounded font-semibold">@everyone</span>);
        } else {
          parts.push(
            <a
              key={key++}
              href={`/profile/${match[10]}`}
              onClick={(e) => e.stopPropagation()}
              title={`Открыть профиль @${match[10]}`}
              className="bg-violet-500/20 dark:bg-cyan-400/20 text-violet-600 dark:text-cyan-300 px-1 rounded font-medium hover:underline cursor-pointer"
            >
              @{match[10]}
            </a>
          );
        }
      }
      else if (match[11]) {
        /* Своего эмодзи с таким именем у сообщества нет — оставляем текст как
           есть. Так «12:30:45» и двоеточия в обычной речи не превращаются в
           дыры, а старые сообщения после удаления эмодзи читаются дальше. */
        const url = options?.emoji?.get(match[11]);
        if (url) {
          parts.push(
            /* 20×20 и выравнивание по нижней границе строки — как у эмодзи
               TrioZ, чтобы картинка не приподнимала строку текста. Оптимизация
               картинок в проекте отключена намеренно, поэтому обычный <img>. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={key++}
              src={url}
              alt={`:${match[11]}:`}
              title={`:${match[11]}:`}
              width={20}
              height={20}
              loading="lazy"
              decoding="async"
              className="inline-block shrink-0 align-text-bottom mx-0.5 w-5 h-5 object-contain"
              draggable={false}
            />
          );
        } else {
          parts.push(<TriozText key={key++} text={match[0]} />);
        }
      }
      lastIndex = match.index + match[0].length;
    }
    if (lastIndex < text.length) parts.push(<TriozText key={key++} text={text.slice(lastIndex)} />);
    return parts.length > 0 ? parts : <TriozText text={text} />;
}

export function parseAttachments(raw: string | null | undefined): Attachment[] {
  if (!raw) return [];
  try { return JSON.parse(raw); } catch { return []; }
}
