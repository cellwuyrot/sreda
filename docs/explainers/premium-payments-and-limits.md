# Explainer — TZ Premium: a real value proposition, channel limits, and admin-run payments

> 🎯 **TL;DR** — This change turns TZ Premium from a vague "coming soon" placeholder into a concrete offer, and gives admins the tools to sell and grant it.
>
> 1. **One source of truth** for what Premium is — a new `premiumFeatures.ts` module (main advantage, the feature list, a comparison table derived from it, and the free-tier channel limit).
> 2. **The top-left Premium popup** (shown to accounts without a subscription) now surfaces the *five dominating* features + the flagship advantage, with a button that deep-links into profile settings to learn more and subscribe.
> 3. **Settings → Premium** highlights the main advantage and renders a **Regular vs Premium comparison table**, plus a "How to subscribe" block listing the payment methods an admin configured.
> 4. **Regular users can own at most 5 communities** ("свои каналы"); Premium and admins are unlimited. Enforced on the server so it can't be bypassed via the API.
> 5. **New admin page `/admin/payments`** (ADMIN only) to configure the receiving payment details: **SBP transfer** and **internet acquiring**.
> 6. **Admin → Premium** gains a **"Subscription + payment"** action: when working with a client's profile, an admin picks a plan, a payment method, an amount and a receipt, and the service grants Premium while recording a `PremiumSubscription` row (with history).

---

## Background

### For newcomers: how the app is wired

TZ (TrioZ) is an **npm-workspaces monorepo**. The user-facing product is a **Next.js 16 (App Router)** app in `apps/web`; there is also an Electron desktop shell in `apps/desktop` and a shared Socket.IO contract in `packages/shared`. The chat product ("TZ.Connect") lives at the `/connect` route. Data is stored in **PostgreSQL via Prisma**; auth is **NextAuth** (JWT). Admin-only configuration that doesn't deserve its own table is stashed in a generic key/value table called `SiteConfig`.

**Premium today.** "Premium" is a single boolean, `User.isPremium`. The NextAuth session layer computes an *effective* premium — `isPremium || role === "ADMIN"` — so admins always behave as premium (see `apps/web/src/lib/auth.ts`). Premium currently unlocks a handful of real features scattered across the code:

> 📌 **Definition — the Premium spec (as it actually exists in code).**
> - **VPN "TZ Secure"** — a protected-connection screen in `overlays/PremiumInfoModal.tsx` (UI ready, tunnel infrastructure pending).
> - **Premium community templates** — gaming/project/support/learning presets in `lib/communityTemplates.ts`, gated in `api/groups`.
> - **Monochrome / Monochrome Lite themes** — premium-only designs in Settings → Appearance.
> - **1080p video** in voice channels (`VoiceContext.tsx`), vs 720p for everyone else.
> - **Instant replay** — save the last 30 s of voice + screen share (`FIX-REPLAY`).
> - **Golden "TZ" mark** in the left nav rail (`NavRail.tsx`) as an at-a-glance premium signal. *(Still in the code, deliberately dropped from the advertised list — it is a status marker, not a capability.)*
>
> Added later, after auditing the code against the list: **message length** (`lib/messageLimits.ts` — half the words and characters without a subscription), **voice bitrate** (`VoiceContext.tsx` — 128 vs 64 kbit/s), **60 fps screen share / camera**, **community sections** (`api/groups/[id]` — `sectionsEnabled`), **digit-free username** (`api/profile`) and **profile decoration** (`api/profile/me` — avatar glow). All of these were already enforced in code but missing from the spec, so users paid for perks nobody told them about.

**Where the popup comes from.** The far-left nav rail (`NavRail.tsx`) renders a "TZ" logo button. Clicking it calls `onOpenPremiumInfo`, which flips `showPremiumInfo` in `app/connect/page.tsx`, which renders `PremiumInfoModal`. For premium accounts the modal is the VPN screen; for everyone else it *was* three generic bullet points ("расширенные сервисные функции…").

**Creating a community.** In this codebase a **Group** is a community; a **Channel** lives inside a group. `POST /api/groups` creates a group, makes the caller its `OWNER`, and seeds channels from a template. There is exactly one built-in community with `isMain: true` that everyone auto-joins.

### The narrow starting point

- `PremiumInfoModal`'s non-premium branch was a placeholder — no real feature list, no path to subscribe.
- Settings → Premium showed only a status pill and one sentence. No comparison, no pricing, no payment instructions.
- Any user could create unlimited communities.
- The admin had a single lever — a `isPremium` toggle in `/admin/premium` — with no notion of *how* the subscription was paid for, and no place to record the receiving bank details.

---

## Intuition

The core realization is that **Premium was under-specified in code, not just in the UI.** The same list of perks needs to appear in at least three places (the popup, the settings comparison, the create-community counter), so the first move is to write that list down *once*:

```ts
// lib/premiumFeatures.ts (excerpt)
export const FREE_COMMUNITY_LIMIT = 5;

export const PREMIUM_MAIN_ADVANTAGE = {
  badge: "Флагман Premium",
  title: "VPN «TZ Secure»",
  description: "Приватное защищённое соединение для сервисов TZ…",
};

export const PREMIUM_KEY_FEATURES = [ /* 5 items: VPN, unlimited communities, 1080p, replay, design */ ];
export const PREMIUM_COMPARISON  = [ /* rows: {feature, free, premium} */ ];
```

Everything downstream just *reads* from this module, so the popup's five features and the settings table can never drift apart.

**The channel limit** is a classic freemium gate. "Свои каналы" maps to *communities you own* (`Group.ownerId === you && !isMain`). Concretely: a free user who already owns five communities gets a 403 from the API and a disabled "Create" button; a premium user or admin sails through. Toy example — Alice (free) owns `{Guild, BookClub, DnD, StudyHall, Raid}` (5). Her sixth `POST /api/groups` returns *"Обычный аккаунт может создать не более 5 своих сообществ."* Bob (premium) owning the same five can still create a sixth.

**Payments** split cleanly into two concerns:

> 📌 **Definition — the two payment concerns.**
> - **Where money lands** — the *receiving* details an admin fills in once (SBP phone/bank/recipient; acquiring provider/link/secret). This is workspace-level config → stored in `SiteConfig`.
> - **What a client bought** — a *per-client* subscription record tying a user to a plan, an amount, a method, and a receipt. This is transactional history → a new `PremiumSubscription` table.

An admin configures the first on `/admin/payments`; the client sees the non-secret parts in Settings → Premium; the admin records the second from `/admin/premium` when a client pays. Granting a subscription flips `isPremium` on and writes a row; the auth cache is invalidated so the client sees Premium immediately.

---

## Code

### 1. The shared spec — `lib/premiumFeatures.ts` (new)

A dependency-free module (safe to import from both client and server). The list is now a **single array** `PREMIUM_FEATURES`, where every entry carries its own table values and an optional `highlight` flag; `PREMIUM_KEY_FEATURES` (the short showcase) and `PREMIUM_COMPARISON` (the table rows) are *derived* from it. Two lists could drift — one cannot. Values like `"—"` / `"✓"` are plain strings that the UI colours conditionally.

Each entry also carries an `id` used as an **icon key**, not an emoji. The icons render through `components/premium/PremiumFeatureIcon.tsx` in the project's own style (outline SVG, 24×24, `stroke 1.9`, `currentColor`), because emoji are drawn by the system font: they look different on Windows, macOS and Android, ignore the theme, and are plain wrong in the monochrome one.

Numeric limits are imported from the modules that enforce them (`messageLimits.ts`), so the showcase cannot drift away from the actual check.

### 2. Server-side community limit — `api/groups/route.ts`

The creator lookup (previously only done for premium templates) now always runs, and two gates share one `canBypassLimits` flag:

```ts
const canBypassLimits = !!creator?.isPremium || creator?.role === "ADMIN";

if (template.premium && !canBypassLimits) { /* 403 — templates are premium */ }

if (!canBypassLimits) {
  const ownedCount = await prisma.group.count({ where: { ownerId: session.user.id, isMain: false } });
  if (ownedCount >= FREE_COMMUNITY_LIMIT) return NextResponse.json({ error: "…не более 5…" }, { status: 403 });
}
```

### 3. Client-side counter — `CreateGroupModal` + `connect/page.tsx`

`connect/page.tsx` computes `ownedCommunitiesCount = groups.filter(g => g.ownerId === userId && !g.isMain).length` and passes it to `CreateGroupModal`, which shows `N/5` and disables the button (`limitReached`) for free users. The server remains the source of truth.

### 4. The popup — `overlays/PremiumInfoModal.tsx`

The non-premium branch is rewritten to render the flagship advantage card, the five `PREMIUM_KEY_FEATURES`, and a **"Подробнее и подключение"** button. A new `onOpenSettings` prop (wired in `connect/page.tsx` to `router.push("/settings?cat=premium")`) closes the modal and deep-links into settings. The premium (VPN) branch is untouched.

### 5. Settings → Premium — `settings/page.tsx`

The `case "premium"` block now renders three sections: **status + main advantage**, the **Regular vs Premium comparison table** (from `PREMIUM_COMPARISON`), and — for non-premium users — a **"How to subscribe"** block populated from `GET /api/payments/methods`. A small effect reads `?cat=premium` from the URL so the deep-link opens the right tab.

### 6. Payment config — `/admin/payments` + `api/admin/payments` (new)

`lib/paymentSettings.ts` centralises the `SiteConfig` keys, defaults, encryption of the acquiring secret, and two readers: `readPaymentConfig()` (full, admin-only) and `readPublicPaymentMethods()` (enabled methods, no secrets). The admin page mirrors the existing `/admin/ai` design (rounded cards, `motion.div`, a shared input class). The API is **ADMIN only**; the acquiring secret is AES-encrypted (same helper as `ai_api_key`) and returned masked.

### 7. Subscriptions — `PremiumSubscription` model + `api/admin/premium/subscriptions` (new)

A new Prisma model records `{userId, plan, paymentMethod, amount, currency, reference, note, status, startedAt, expiresAt, grantedById}`. The API (ADMIN only):

- **POST** — creates a subscription (expiry computed from the plan), sets `isPremium = true`, invalidates the auth cache, and emits `account-premium-updated`.
- **PATCH** — cancels a subscription; if the user has no remaining active subscriptions, clears `isPremium`.
- **GET `?userId=`** — the client's subscription history.

`/admin/premium` gains a **"Subscription + payment"** button (ADMIN only, non-admin targets) that opens a modal to pick plan/method/amount/receipt and shows the history. A migration lives at `prisma/migrations/20260722000000_premium_subscriptions_payments/`.

---

## Verification

> ⚠️ **Environment caveat.** This sandbox blocks Prisma's engine CDN and Google Fonts. The Prisma **client types** were generated in `--no-engine` mode (enough to type-check and compile), and `next build` cannot finish only because `next/font/google` can't fetch Inter/Playfair — unrelated to this change.

Automated checks that *do* run, both green:

- **Type-check** — `npx tsc --noEmit` → 0 errors (after `npm run build:shared`).
- **Lint** — `npm run lint` (`eslint src/ --quiet`) → 0 errors.

**Manual QA (needs a Postgres DB + fonts, i.e. a normal dev machine):**

1. Run the migration (`npm run migrate` or `prisma migrate deploy` in `apps/web`).
2. As **admin** → `/admin/payments`: enable SBP, fill phone/bank/recipient, set a price, save. Enable acquiring, paste a link + secret, save; reopen and confirm the secret shows masked and "сохранён".
3. As a **regular user** → `/connect`: click the top-left "TZ" mark. Confirm the popup shows the flagship advantage + five features + "Подробнее и подключение". Click it → lands on Settings → Premium with the comparison table and the SBP/acquiring instructions + price.
4. As the same user, create communities until you own five, then try a sixth — the button reads "Достигнут лимит" and the API returns 403.
5. As **admin** → `/admin/premium`: on that user click **"Подписка + оплата"**, pick *SBP / 1 месяц / 299 ₽*, add a receipt, confirm. The user's status flips to Premium; reopening the modal shows the record in history. The user's sixth-community block disappears.
6. Cancel from history (PATCH) → confirm Premium is removed when no active subscriptions remain (admins keep premium by role).

---

## Alternatives

**A. Store subscription/payment fields directly on `User` instead of a `PremiumSubscription` table.**

| Pros | Cons |
|------|------|
| No new table or join | No history — only the *latest* payment survives |
| Simpler query for "current plan" | User row grows 6–7 payment columns unrelated to identity |
| One fewer migration | Refunds/renewals/audits are impossible to reconstruct |

**B. Integrate a real payment gateway (YooKassa/Tinkoff webhook) that auto-grants Premium.**

| Pros | Cons |
|------|------|
| Fully automated, no admin step | Much larger surface: webhooks, idempotency, secrets, reconciliation |
| Instant activation for the buyer | Overkill for a manual/SBP-first flow; the request was explicitly admin-driven |
| Fewer human errors | Ties the product to one provider's API and its failure modes |

The chosen design (config in `SiteConfig`, history in `PremiumSubscription`, admin-driven grant) matches the stated requirement — an admin fills in receiving details and connects the subscription to a payment when working with a client's profile — and leaves a clean seam to bolt on gateway automation later.

---

## Suggested people to talk to

- **ANDYCOULBOT** (`ANDYCOULBOT@ANDYPC`) — the primary author of `connect/page.tsx`, the admin panel (`admin/page.tsx`, `admin/premium/page.tsx`), the groups API, and `GroupDialogs.tsx`. The right person to sanity-check the community-limit gate and the admin premium/payments UI, since they own most of the surfaces this PR touches.
- **acoulbot** (`infinitas.vine@gmail.com`) — repo owner and the person who merges most PRs; good for a high-level read on whether the manual admin-driven payment model fits the product roadmap (vs a gateway integration).
- **freedomsoftware** — authored the premium "Монохром" theme system referenced in the comparison table. Worth a ping to confirm the premium *design language* (gold mark, amber accents) is applied consistently in the new popup and settings sections. *(Note: much of the recent `settings/page.tsx` premium/replay code was AI-authored, so treat those commits as low-context.)*

---

## Quiz

<details>
<summary>1. Why is the free-community limit enforced in <code>api/groups/route.ts</code> and not only in <code>CreateGroupModal</code>?</summary>

- **A.** Because the modal can't count communities. — *Incorrect; it receives `ownedCount`.*
- **B. Because client checks can be bypassed by calling the API directly, so the limit must be authoritative on the server.** — *Correct. The modal's disabled button is UX; the 403 in the route is the real gate (mirroring how premium templates are already server-checked).*
- **C.** Because Prisma can't run in the browser. — *True but irrelevant to why the gate lives server-side.*
- **D.** To avoid a migration. — *Incorrect; unrelated.*
</details>

<details>
<summary>2. What exactly counts as one of a user's "own channels" for the limit?</summary>

- **A.** Every channel in every community they've joined. — *Incorrect; that's `Channel` membership.*
- **B.** Communities they are a member of. — *Incorrect; membership ≠ ownership.*
- **C. Communities they own (`Group.ownerId === user`) excluding the built-in main community (`isMain`).** — *Correct — see both the server `count` and the client `filter`.*
- **D.** Premium community templates only. — *Incorrect.*
</details>

<details>
<summary>3. Where does the receiving SBP/acquiring configuration live, and how is the acquiring secret protected?</summary>

- **A. In the `SiteConfig` key/value table; the acquiring secret is AES-256-GCM encrypted via the same helper as `ai_api_key` and returned masked.** — *Correct.*
- **B.** In a new `PaymentConfig` table, stored in plaintext. — *Incorrect; no new config table, and secrets are encrypted.*
- **C.** In environment variables. — *Incorrect.*
- **D.** On each `User` row. — *Incorrect.*
</details>

<details>
<summary>4. After an admin connects a subscription via <code>POST /api/admin/premium/subscriptions</code>, why does the client see Premium almost immediately?</summary>

- **A.** The client polls the DB every second. — *Incorrect.*
- **B. The route sets `isPremium=true`, calls `invalidateUserAuthCache(userId)`, and emits `account-premium-updated`, so the next session refresh reads the fresh flag instead of a stale cached one.** — *Correct — the auth layer caches premium/role briefly, so it must be invalidated.*
- **C.** It forces a full logout. — *Incorrect.*
- **D.** `isPremium` is derived from the subscription table on every request. — *Incorrect; `isPremium` remains the source of truth and is set explicitly.*
</details>

<details>
<summary>5. Why is <code>lib/premiumFeatures.ts</code> kept free of any server-only imports (like <code>prisma</code>)?</summary>

- **A.** To keep the file small. — *Incorrect; that's incidental.*
- **B. Because it's imported by both client components (the popup, settings, create-community modal) and server code (the groups API); importing `prisma`/`encryption` there would pull server-only code into the client bundle.** — *Correct. Payment logic that *does* need `prisma` lives in the separate, server-only `lib/paymentSettings.ts`.*
- **C.** Because constants can't import anything. — *Incorrect; they can.*
- **D.** To avoid a circular import with `auth.ts`. — *Incorrect; there is no such cycle.*
</details>

---

## Срок подписки начал действовать (правка от 08.2026)

При выдаче подписки срок считался и раньше: план «месяц» → `expiresAt` = +1 месяц.
Но проверять его было некому — `User.isPremium` оставался `true` навсегда, и
подписка на месяц работала бессрочно.

Теперь срок действует:

- **`lib/premiumExpiry.ts`** — задача `expireOverduePremium()`: подписки со
  прошедшим `expiresAt` переводятся в `status: "expired"`, и у тех, у кого не
  осталось ни одной действующей, снимается флаг `isPremium`. Администраторов не
  задевает: премиум им даёт роль, а не флаг.
- **`server.ts`** — запуск раз в шесть часов и через минуту после старта, под тем
  же распределённым локом, что и остальные задачи по расписанию.
- **`GET /api/profile`** отдаёт `premium.daysLeft` и не считает премиум
  действующим, если дата уже прошла. Это нужно из-за окна между тиками задачи:
  человек, открывший настройки через час после конца срока, должен видеть правду,
  а не «подписка без срока».
- **Настройки → Подписка** показывают счётчик: «Осталось 12 дней», «Подписка
  заканчивается сегодня», «Срок подписки истёк». Отдельного предупреждения за
  неделю до конца это не отменяет.

Оговорка про сессию: пределы на сервере читают `isPremium` из базы, поэтому после
снятия флага они действуют сразу. Метка Premium в уже открытом интерфейсе может
продержаться до обновления страницы — клиенту при снятии уходит событие
`account-premium-updated`.

## Отозвано в той же правке

- **Предел глубины истории.** Обычный аккаунт видел последние 30 дней в прокрутке
  и поиске. Со стороны человека это выглядело не как ограничение тарифа, а как
  потеря переписки: сообщения есть, найти нельзя. Пункт «Вся история переписки»
  убран и из списка преимуществ — обещать то, что доступно всем, нечестно.
- **Автоочистка вложений** (`lib/fileCleanup.ts`, удалён). Удаляла с диска файлы
  старше 14 дней крупнее 1 МБ; в переписке оставалась подпись «изображение
  удалено для оптимизации хранилища». Экономия места вышла дороже, чем стоила.
  Вложения живут столько же, сколько сообщение, к которому приложены.

**Место на диске теперь не освобождается автоматически.** Это осознанный размен;
если объём вложений станет проблемой, правильный следующий шаг — не удаление
файлов у людей за спиной, а перенос старых вложений в холодное хранилище.
