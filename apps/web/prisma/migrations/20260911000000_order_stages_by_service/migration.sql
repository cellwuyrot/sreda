-- STAGES: этапы работ перестают быть одним вшитым списком на все услуги.
--
-- ── Что чинится ─────────────────────────────────────────────────────────────
--
-- Кабинет партнёра показывал по любому проекту десять пунктов создания САЙТА —
-- «Дизайн-макет подготовлен», «Вёрстка выполнена», «Домен и хостинг настроены».
-- Услуг одиннадцать, и заказчику «Честного Знака» или телеграм-бота кабинет
-- обещал работы, которых в его заказе нет. Набор этапов теперь выбирается по
-- услуге проекта, а владелец может править его шестерёнкой у услуги.

-- ── 1. Свой набор этапов у услуги ───────────────────────────────────────────
--
-- NULL — «набор не правили»: этапы берутся из каталога по названию услуги
-- (lib/orderStages.ts). Значение по умолчанию не ставим намеренно: пустой
-- массив и NULL должны различаться, иначе нельзя отличить «не трогали» от
-- «стёрли всё», а второе для кабинета означало бы карточку без прогресса.
ALTER TABLE "Service" ADD COLUMN IF NOT EXISTS "stages" JSONB;

-- ── 2. Услуга проекта ───────────────────────────────────────────────────────
--
-- ON DELETE SET NULL, а не CASCADE: удаление услуги из списка — это уборка в
-- витрине, а не отмена уже сделанной работы. Каскад стёр бы вместе с услугой
-- все проекты по ней, включая запущенные.
ALTER TABLE "PartnerProject" ADD COLUMN IF NOT EXISTS "serviceId" TEXT;

CREATE INDEX IF NOT EXISTS "PartnerProject_serviceId_idx" ON "PartnerProject"("serviceId");

ALTER TABLE "PartnerProject" DROP CONSTRAINT IF EXISTS "PartnerProject_serviceId_fkey";
ALTER TABLE "PartnerProject" ADD CONSTRAINT "PartnerProject_serviceId_fkey"
    FOREIGN KEY ("serviceId") REFERENCES "Service"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 3. Обращение, в чате которого обсуждается проект ────────────────────────
--
-- Своего мини-чата у проекта больше нет: разговор ведётся в деловом чате по
-- обращению (DirectConversation kind = BUSINESS). Ссылка проставляется при
-- первом переходе в чат — без неё каждое нажатие заводило бы новое обращение,
-- то есть новый разговор о том же самом.
--
-- Уникальности здесь нет осознанно: несколько проектов одного заказчика по
-- одной услуге ведутся в одном разговоре, и это то, чего он ждёт, — не пять
-- чатов с одной и той же администрацией.
ALTER TABLE "PartnerProject" ADD COLUMN IF NOT EXISTS "appealId" TEXT;

CREATE INDEX IF NOT EXISTS "PartnerProject_appealId_idx" ON "PartnerProject"("appealId");

ALTER TABLE "PartnerProject" DROP CONSTRAINT IF EXISTS "PartnerProject_appealId_fkey";
ALTER TABLE "PartnerProject" ADD CONSTRAINT "PartnerProject_appealId_fkey"
    FOREIGN KEY ("appealId") REFERENCES "Appeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ── 4. Отметки выполненных этапов: номера → идентификаторы ──────────────────
--
-- В "stepsDone" лежали НОМЕРА пунктов единственного списка: [0, 1, 2]. Номер
-- переживает правку набора ровно до первого удаления шага — после него все
-- следующие съезжают, и у проекта оказываются отмечены не те работы. Поэтому
-- хранится идентификатор этапа.
--
-- Номер N старого списка соответствует этапу "site-(N+1)" каталожного набора
-- «Создание сайтов»: тексты пунктов там оставлены слово в слово, так что ни
-- одна отметка не меняет смысла.
--
-- WHERE с проверкой jsonb_typeof: перевод должен быть идемпотентным. Уже
-- переведённый массив строк повторный прогон не тронет — иначе строки
-- превратились бы в NULL и прогресс всех проектов обнулился.
--
-- Смешанный массив (часть номеров уже заменена идентификаторами) разбирается
-- поэлементно, а не приведением всего массива к числам: при выкатке кабинет
-- какое-то время работает старым кодом рядом с новым, и в одном "stepsDone"
-- могут оказаться и 3, и "site-1". Прежний вариант с e.idx::int на такой
-- строке падал с invalid input syntax for integer и ронял всю миграцию.
-- Числа переводятся по таблице ниже, уже готовые идентификаторы остаются как
-- есть, номер вне диапазона 0..9 отбрасывается — набор сайта из десяти
-- пунктов, одиннадцатого никогда не было.
--
-- Порядок берётся из позиции в массиве и значения не имеет: "stepsDone" —
-- множество отметок, а список кабинет рисует по порядку НАБОРА этапов
-- (см. normalizeDoneStages в lib/orderStages.ts).
--
-- На чистой установке таблица только что создана и пуста — UPDATE не находит
-- ни одной строки и проходит вхолостую.
UPDATE "PartnerProject" p
SET "stepsDone" = COALESCE((
        SELECT jsonb_agg(x.val ORDER BY x.ord)
        FROM (
            SELECT e.ord AS ord,
                   CASE
                       WHEN jsonb_typeof(e.item) = 'number' THEN m.stage_id
                       ELSE e.item #>> '{}'
                   END AS val
            FROM jsonb_array_elements(p."stepsDone") WITH ORDINALITY AS e(item, ord)
            LEFT JOIN (VALUES
                    (0, 'site-1'),
                    (1, 'site-2'),
                    (2, 'site-3'),
                    (3, 'site-4'),
                    (4, 'site-5'),
                    (5, 'site-6'),
                    (6, 'site-7'),
                    (7, 'site-8'),
                    (8, 'site-9'),
                    (9, 'site-10')
                 ) AS m(ord, stage_id)
                 ON jsonb_typeof(e.item) = 'number'
                AND e.item::text ~ '^[0-9]+$'
                AND m.ord = (e.item::text)::int
        ) x
        WHERE x.val IS NOT NULL
    ), '[]'::jsonb)
WHERE jsonb_typeof(p."stepsDone") = 'array'
  AND EXISTS (
        SELECT 1 FROM jsonb_array_elements(p."stepsDone") AS elem(item)
        WHERE jsonb_typeof(item) = 'number'
  );

-- ── 5. Уже созданные проекты получают услугу «Создание сайтов» ──────────────
--
-- Иначе они остались бы без услуги, а значит и без набора этапов, привязанного
-- к чему-то осмысленному. Услуга проставляется именно эта, потому что других
-- этапов в кабинете до сих пор не было: каждый существующий проект вёлся по
-- десяти пунктам разработки сайта, и подменять их задним числом другим набором
-- значило бы сдвинуть отметки идущих работ.
--
-- Услуги с таким названием может не быть (её переименовали или удалили) —
-- тогда проекты остаются без услуги, и код показывает им тот же набор сайта
-- как запасной. Терять отметки в любом случае нечему.
UPDATE "PartnerProject" p
SET "serviceId" = (
        SELECT s.id FROM "Service" s
        WHERE s.title = 'Создание сайтов'
        ORDER BY s."order" ASC
        LIMIT 1
    )
WHERE p."serviceId" IS NULL
  AND EXISTS (SELECT 1 FROM "Service" s WHERE s.title = 'Создание сайтов');
