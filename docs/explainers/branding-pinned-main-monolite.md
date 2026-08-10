# Explainer — TZ branding refresh, pinned main community, and a strict black-on-white Monochrome Lite

> 🎯 **TL;DR** — Four independent changes ship together:
>
> 1. **Applied the `trioz-fixes-tech` package** (from `docs/explainers/trioz-fixes-tech.zip`): the task board now scales without a horizontal scrollbar, the knowledge base surfaces save errors instead of silently failing, and a new per-section settings gear (`ModuleSettingsModal`) controls who can read/edit a work module. No DB migration required.
> 2. **New TZ logo** as icon + favicon across web and desktop (black **T** / teal **Z**, hand-brushed).
> 3. **The main community “TZ Connect” is now pinned** at the top of the community list and no longer participates in drag-and-drop reordering or folder grouping. The instructional hint text was removed.
> 4. **Monochrome Lite** was reworked into a strict **black text on white background** theme (grey only for borders / secondary text), and on `/connect` the background is removed entirely (flat white panels, black headings).

---

## Background

### For newcomers: how the app is wired

TZ (TrioZ) is an npm-workspaces monorepo. The user-facing app is a Next.js project in `apps/web`; there is also an Electron desktop shell in `apps/desktop`. The chat product lives at the `/connect` route.

**Theming.** Themes are plain CSS driven by classes on `<html>`. `apps/web/src/components/Providers.tsx` toggles four classes: `dark`, `light`, `mono`, and `mono-lite`. Crucially, the two premium “Monochrome” themes are *built on top of* the base themes:

> 📌 **Definition — theme layering.** `mono` = `dark` + `mono` (a dark premium theme); `mono-lite` = `light` + `mono-lite` (a light premium theme). Because the light/dark base class is always present, Tailwind’s `light:`/`dark:` utilities keep working, and the premium theme only needs to *override* colours and surfaces in `globals.css`.

The three-panel `/connect` layout is painted by three helper classes — `.cn-rail` (the far-left icon nav), `.cn-sidebar` (the community/channel column), and `.cn-main` (the chat area) — each reading a CSS variable (`--cn-rail`, etc.). A set of `--cn-*` variables (`--cn-text`, `--cn-muted`, `--cn-accent`, `--cn-accent-dim`, `--cn-accent-text`, `--cn-border`, `--cn-hover`) is redefined per theme, so most components style themselves purely by referencing those variables.

**The community list.** `GroupListPanel.tsx` renders the list of communities you belong to, with Discord-style drag-and-drop: drag to reorder, drop one community on another to make a folder. The *arrangement* (order + folders) is a personal layout persisted to `/api/groups/layout`; the *set* of communities is server data passed in as the `groups` prop. Each group object carries an `isMain` flag — exactly one community (the built-in “TZ Connect”) has `isMain: true`, and the API already sorts it first.

### The narrow starting point

- The task board panel (`TasksPanel.tsx`) had a fixed-width details pane (`w-[26rem]`) that, combined with three `min-w-[18rem]` columns, overflowed on ~1330px screens.
- The wiki API (`/api/wiki`) rejected any channel whose type wasn’t `WIKI` — but section blocks are created as `NEWS`/`TEXT`, so article/glossary creation always 400’d, and `WikiPanel.tsx` swallowed the error (`if (!res.ok) return;`).
- `GroupListPanel` let *every* community be dragged, including the main one, and always showed the hint “Перетаскивайте сообщества, чтобы изменить порядок…”.
- `Monochrome Lite` was an “Atelier: paper & graphite” theme: off-white surfaces (`#f2f2f3`), graphite ink (`#1c1d20`), fractal-noise grain, brushed-metal gradients, frosted glass, and a gradient wordmark on the `/connect` welcome screen. On `/connect` it *also* rendered the animated `DayNightBackground` (because that component only bailed out for `mono`, not `mono-lite`) and the dark space scene in `ConnectWelcome` (because `isDark = theme !== "light"` is true for `mono-lite`).

---

## Intuition

### Pinning the main community

The realization is that “not draggable and not groupable” is the same as “not part of the layout at all.” So we split the incoming `groups` into two buckets:

```
groups ── isMain? ──> mainGroup      (rendered once, pinned at the very top)
                └────> orderableGroups (the only thing the DnD layout ever sees)
```

`normalize()` — the function that reconciles the saved layout against live membership — is fed `orderableGroups` instead of `groups`. Because it builds its “known ids” set from that list, the main community is *automatically* dropped from any stored order or folder, and is never appended. The pinned row is then rendered with drag disabled. Belt-and-braces: `beginDrag()` also early-returns if asked to drag the main id.

> ⚠️ **Edge case — the ESLint `react-hooks/refs` rule.** The new React hooks lint rule flags “passing a ref-reading function (`beginDrag`) to a handler during render” — but only when the render helper is *called directly* in the component body. Rendering the pinned row inside a one-element `.map()` (`(mainGroup ? [mainGroup] : []).map(...)`) keeps the exact JSX the rule already tolerates for the mapped rows, so no lint error is introduced.

### Strict black-on-white Monochrome Lite

The old theme created depth with texture and gradients. The new brief is the opposite: *remove* everything and let pure contrast do the work. Concretely, `--background`/`--cn-main`/… all become `#ffffff`, every text variable becomes `#000000`, and grey (`#5f6167`, `rgba(0,0,0,0.1)`) is reserved for borders, secondary text and hovers. Then every rule that painted a texture or gradient is flattened:

```
body::before  (fractal grain overlay)   → removed
.cn-rail/.cn-sidebar/.cn-main (gradients) → flat #fff + a 1px grey divider
.glass-card (frosted blur)               → flat white + grey border
.btn-primary (brushed aluminium)         → light-grey fill, black text
.section-title (graphite gradient text)  → solid #000
```

On `/connect` two *component-level* background sources also had to go: `DayNightBackground` now returns `null` for `mono-lite` (as it already did for `mono`), and `ConnectWelcome` gets a dedicated `mono-lite` branch that renders a plain white screen with a black `CONNECT` wordmark instead of the space scene. The premium gold “TZ” mark in `NavRail` is likewise swapped for a quiet black-on-grey mark.

---

## Code

### 1. Update package (unmodified, copied to their paths)

`TasksPanel.tsx`, `WikiPanel.tsx`, `ModuleSettingsModal.tsx` (new), `api/wiki/route.ts`, `api/wiki/[id]/route.ts`. The details pane became responsive and the columns relax on desktop:

```tsx
// details pane: was w-[26rem]
<div className="hidden lg:block lg:w-[30vw] lg:min-w-[17rem] lg:max-w-[26rem] shrink-0 …">
// columns: was min-w-[18rem]
className="… min-w-[18rem] md:min-w-[12rem] …"
```

The wiki API stopped hard-rejecting non-`WIKI` channels (only `VOICE`/`CATEGORY` are refused now) and gained `canReadChannel` / a `postAccess`-aware `canEditWiki`, both driven by existing channel fields (`postAccess`, `isRestricted`, role-access relations) — so **no migration**. `ModuleSettingsModal` saves those fields through the existing `PUT /api/channels/[id]`.

### 2. Branding assets

All raster icons were regenerated from a single recreated master and composited on **white** (the black “T” would vanish on dark tabs/surfaces otherwise). Files touched: `apps/web/public/{logo.png, icon-512.png, icon-192.png, apple-touch-icon.png, favicon-16x16.png, favicon-32x32.png, favicon.ico}`, `apps/web/src/app/favicon.ico`, and the desktop `icon.png`/`icon.ico`/`tray.png`/`trayTemplate.png` (the macOS tray icon is a black silhouette on transparency, as template images require).

### 3. Pinned main community (`GroupListPanel.tsx`)

```tsx
const mainGroup = useMemo(() => groups.find((g) => g.isMain) ?? null, [groups]);
const orderableGroups = useMemo(() => groups.filter((g) => !g.isMain), [groups]);
// normalize() now builds its "known" set and its append loop from orderableGroups

// beginDrag(): main community can't initiate a drag
if (mainGroup && groupId === mainGroup.id) return;

// render: pin main first (via .map to satisfy the hooks lint rule), then the layout
{(mainGroup ? [mainGroup] : []).map((g) => renderGroupRow(g, { inFolder: false, pinned: true }))}
{items.map(...)}
```

`renderGroupRow` gained a `pinned` option that forces off the combine/insert drop indicators; the hint `<div>` (and its now-unused `hintStyle`) were deleted.

### 4. Monochrome Lite (`globals.css` + three components)

The entire `.light.mono-lite` block in `globals.css` was rewritten (variables → white/black/grey; textures/gradients → flat; `section-title` → solid black; scrollbars/selection/dot-grid → grey-on-white). In components:

```tsx
// DayNightBackground.tsx
if (theme === "mono" || theme === "mono-lite") return null;

// ConnectWelcome.tsx — new branch: white screen, black CONNECT, minimal buttons
if (theme === "mono-lite") { return ( … background:#fff, color:#000 … ); }

// NavRail.tsx — premium mark for mono-lite: black-on-grey, no gold glow
```

---

## Verification

> ⚠️ **Environment limitation.** This sandbox cannot download Prisma’s engine binaries (`binaries.prisma.sh` returns 403) or run the app against a database, so `prisma generate` / `next build` / a live UI screenshot are **not** possible here — the same CI-only build situation noted in the previous PR’s explainer. Everything not requiring those was run.

- ✅ **ESLint** over all changed files: **0 errors**. The only warnings are pre-existing (`ConnectWelcome`’s `Date.now()`/`Math.random()` seed) or come verbatim from the update package (`set-state-in-effect`). My hand-written changes add **zero** warnings.
- ✅ **TypeScript** (`tsc --noEmit`): the project reports the *same* class of errors with and without my changes — all `TS7006`/`TS2305` cascades from the un-generated Prisma client. Baseline = 81 errors; with my changes = 83. The +2 are `implicit any` on `tags.map((t) => …)` in the update-package wiki routes; with a generated client (i.e., in CI) `tags` is typed and they vanish. **No error lands in a hand-edited file.**
- ✅ **Schema/endpoint compatibility** confirmed by reading the code: the new wiki logic uses existing `Channel.postAccess`/`isRestricted`/`allowedRoles` and `GroupMemberRole`; `ModuleSettingsModal` uses the existing `GET`/`PUT /api/channels/[id]` (which already handle `postAccess`, `isRestricted`, `roleIds`).
- ✅ **Logo** rendered and visually reviewed at multiple sizes; `.ico`s contain the correct frame set; the macOS template is black+alpha only.

### Manual QA guide (after deploy)

1. Open `/connect` → the community list shows **TZ Connect pinned at the top**; try to drag it — it doesn’t move and can’t be dropped onto/into anything. Other communities still reorder and form folders. The hint line under the list is gone.
2. Switch to **Mono Lite** (Settings → Внешний вид, Premium required). `/connect` should be pure white with black text, thin grey dividers, no grain/gradients, no animated horizon, and a plain white welcome screen with a black `CONNECT`.
3. Check the browser tab — the new TZ favicon appears; add-to-home-screen shows the white-tile TZ icon.
4. On a ~1330px-wide screen, open a channel’s **Задачи** board → all three columns + the details pane fit with no horizontal scrollbar. The gear (creator/admin/moderator only) opens the section settings modal.
5. In a **База знаний** section, save an article with an empty title → a red error message appears instead of a silent no-op.

---

## Alternatives

### Pinning the main community: exclude from layout vs. lock in place

| Chosen: split into `mainGroup` + `orderableGroups`, render main separately | Alternative: keep main in the layout but flag it “locked” everywhere |
|---|---|
| ✅ DnD/normalize code never even sees the main community | ✅ Single render path |
| ✅ Impossible to accidentally fold/reorder it | ✅ Slightly less code churn |
| ❌ Two render sites for a community row | ❌ Every drop/normalize branch needs a “is this locked?” guard; easy to miss one |

### Monochrome Lite background: flat white surfaces vs. fully transparent panels

| Chosen: white `.cn-*` panels + 1px grey dividers | Alternative: `background: transparent` on all panels |
|---|---|
| ✅ Columns stay visually delineated | ✅ Even less CSS |
| ✅ “Background removed” reads as clean white, not empty | ❌ Panels blur together; loses the sense of structure |
| ❌ A hair more CSS than pure `transparent` | ❌ Any parent tint would leak through |

---

## Suggested people to talk to

Almost every file here was last authored by the **`Claude` AI committer**, so there isn’t a deep human owner for most of it — review on its own merits.

The one worth pinging is **`freedomsoftware`** (`freedomsoftware07+…@gmail.com`), who authored the premium **“Монохром”** theme system and the `NavRail` gold-mark / `DayNightBackground` light-scene work (commit *“feat(theme): убрать тему Velvet, добавить премиум-дизайн «Монохром»”*). They are the closest thing to an owner of the Monochrome design language and are the right person to sanity-check that stripping Mono Lite down to black-on-white is the intended direction rather than a regression of a deliberately “material” premium aesthetic.

---

## Quiz

<details>
<summary><strong>1. Why is the main community excluded from <code>normalize()</code> rather than just hidden from drag handlers?</strong></summary>

- **A.** Because `normalize()` runs on the server. — *Incorrect; it runs client-side.*
- **B.** Because `normalize()` rebuilds the saved order/folders from the list it’s given; feeding it `orderableGroups` guarantees the main community can never end up in a stored order or folder. — ✅ **Correct.**
- **C.** Because the main community has no `id`. — *Incorrect; it has an id and `isMain: true`.*
- **D.** To avoid an API call. — *Incorrect; the layout still saves as before.*
</details>

<details>
<summary><strong>2. Why is the pinned row rendered via <code>(mainGroup ? [mainGroup] : []).map(...)</code> instead of <code>{mainGroup && renderGroupRow(...)}</code>?</strong></summary>

- **A.** Performance. — *Incorrect; it’s a one-element array.*
- **B.** To support multiple main communities. — *Incorrect; there’s only ever one.*
- **C.** The `react-hooks/refs` lint rule errors when `renderGroupRow` (which passes the ref-reading `beginDrag`) is called directly in the render body, but tolerates it inside a `.map()` callback. — ✅ **Correct.**
- **D.** JSX can’t render a conditional. — *Incorrect; it can.*
</details>

<details>
<summary><strong>3. On <code>/connect</code>, which THREE background sources had to be neutralised for Mono Lite?</strong></summary>

- **A.** `body::before` grain, the `.cn-*` panel gradients, and localStorage. — *Partly; localStorage is unrelated.*
- **B.** The `body::before` grain overlay, the `.cn-rail/.cn-sidebar/.cn-main` textured gradients (CSS), and the `DayNightBackground` + `ConnectWelcome` space scene (components). — ✅ **Correct.**
- **C.** Only the CSS variables. — *Incorrect; components paint backgrounds too.*
- **D.** The favicon. — *Incorrect.*
</details>

<details>
<summary><strong>4. Why did the wiki API bug break glossary creation as well as articles?</strong></summary>

- **A.** The glossary uses a separate endpoint. — *Incorrect; it uses the same articles (a “term” field).*
- **B.** Glossary terms are stored as wiki articles, so the same `channel.type !== "WIKI"` 400 blocked both. — ✅ **Correct.**
- **C.** Glossary needs a migration. — *Incorrect; no migration is involved.*
- **D.** The glossary is admin-only. — *Incorrect.*
</details>

<details>
<summary><strong>5. Why were the raster icons composited on a white tile instead of kept transparent?</strong></summary>

- **A.** Transparency isn’t supported by `.ico`. — *Incorrect; it is.*
- **B.** The logo’s “T” is black, so on a dark browser tab or the dark-theme splash a transparent version would be partly invisible; white matches the original artwork and guarantees contrast. — ✅ **Correct.**
- **C.** To reduce file size. — *Incorrect.*
- **D.** iOS forbids transparent icons entirely. — *Incorrect; the reasoning is contrast, though opaque apple-touch icons are indeed recommended.*
</details>
