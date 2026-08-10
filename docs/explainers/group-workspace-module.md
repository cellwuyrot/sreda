# Explainer — A group "Рабочая среда": collaborative canvases as a section module

> 🎯 **TL;DR** — Every community *except* the built-in main "TZ Connect" gets a new **"Рабочая среда"** section module: a shared, infinite canvas (up to 5 named boards) that all members can open and edit together.
>
> - The module is a **new channel type, `CANVAS`**, so it inherits the whole existing "Разделы" machinery for free: the sections panel, the per-section settings gear (`ModuleSettingsModal`), and the server-side access checks (`getChannelPermissions`).
> - The canvas itself is the **existing personal `WorkspaceCanvas` engine**, parametrized to run in a *group* mode: it loads/saves state per channel and syncs edits in real time over the channel's socket room.
> - **Access rules** are exactly the module rules: moderators and above always see and edit; an optional role restriction gates reading; members without access simply don't see the section (skeletonized — nothing renders).
> - The 5-board cap is enforced on the client *and* re-clamped on the server.

---

## Background

### For newcomers: how the app is wired

TZ.Connect (`/connect`) is a Discord-style chat. A **Group** is a community; a **Channel** lives inside a group. Channels have a `type` — `TEXT`, `VOICE`, and a family of "module" types (`NEWS`, `QA`, `WIKI`, `CALENDAR`, `DOCS`, `TASKS`, `APPEALS`). The module channels are surfaced not in the main channel list but in a right-hand **"Разделы"** panel (`ModulesPanel`), and clicking one renders a dedicated panel component (`WikiPanel`, `TasksPanel`, …). Admins add/remove these modules from **Group settings → "Рабочая среда"** (`WorkspaceManager`).

> 📌 **Definition — a "module channel".** A channel whose `type` is in `MODULE_TYPES`. It's rendered as a card in `ModulesPanel` instead of a line in the text-channel list, and it opens a purpose-built panel rather than a message stream.

**Access control for modules already exists.** The gear on a module opens `ModuleSettingsModal`, which writes two things onto the channel row (no migration needed):

- `postAccess` — **who can edit**: `ALL` (everyone), `MOD` (creator + moderators), `ADMIN` (creator + admins).
- `isRestricted` + `ChannelRoleAccess` rows — **who can read**: everyone, or only members holding one of the selected custom roles.

The single function `getChannelPermissions(userId, channelId)` turns all of that into booleans: `canView`, `canPost`, `canModerate`, etc. Crucially, **moderators and above bypass the read restriction** (`passesRestriction = !isRestricted || canModerate || hasAllowedRole`). And `/api/groups/[id]` already *omits* restricted/hidden channels a member can't see, so an unauthorized user never even receives the card.

> 📌 **Definition — "skeletonization".** In this codebase, "нет доступа → скелетон" means the content simply isn't delivered/rendered for that user. For a role-restricted module, the group-detail API filters the channel out of the member's channel list, so the section is invisible — exactly the behaviour requested.

**The personal workspace.** There is already a `/workspace` page — an infinite canvas of draggable cards (tasks, notes, links, images, drawings, tables) connected by edges, organized into up to **5 named boards** (`MAX_BOARDS = 5`) via a `BoardSwitcher`. Its state (`StoredState` = `{v:3, boards, activeId, timer}`) is cached in `localStorage` and persisted to `/api/workspace` (one row per user, model `WorkspaceState`). It already syncs across a *single user's* devices: on save it emits `workspace-updated` to that user's personal socket room, and other tabs refetch.

### The narrow starting point

- `WorkspaceCanvas` was hard-wired to *one user*: `storageKey(userId)`, `fetch("/api/workspace")`, `socket.emit("join-dm", userId)`, a full-screen `h-[100dvh]` layout, and a header link back to `/connect`.
- The module system (`MODULE_TYPES`, `ModulesPanel` metadata, `WorkspaceManager`, the two `type ===` switches in `connect/page.tsx`, `ChannelSidebar`) knew nothing about a canvas type.

---

## Intuition

The key insight: **the requested access model is already the module access model.** "Moderators+ always in", "restrict by role", "no access → nothing shows" are precisely `canModerate` bypass + `isRestricted`/roles + the group-detail filter. So if the group workspace is *a module channel*, we don't reinvent permissions, settings UI, or skeletonization — we inherit them.

That reduces the problem to two moves:

1. **Register a new module type `CANVAS`** everywhere the other module types are listed.
2. **Teach the existing canvas engine to run against a channel instead of a user.**

For (2), think of the personal cross-device sync and just widen the audience. Today: *user U saves → server stores under U → server pings U's other devices → they refetch.* For a group: *member A saves → server stores under channel C → server pings everyone in C's room → they refetch.* Same shape, different key.

Concretely, with two members editing board "Roadmap":

```
A drags a card         → debounced PUT /api/channels/C/workspace {data, clientId:A}
server upserts row(C)   → emitToChannel(C, "channel-workspace-updated", {clientId:A})
B (in room channel-C)   → ignores? clientId≠B → refetch → applyStored(freshState)
```

> ⚠️ **Edge case — the echo loop.** Applying a refetched state changes React state, which would re-fire the save effect, which pings everyone, who refetch, who re-save… forever, even idle. The fix is a one-shot `skipNextSaveRef`: whenever we apply state that *came from* a load/remote event, we skip exactly the next save. Genuine local edits still save.

> ⚠️ **Edge case — yanking a collaborator's board.** `StoredState.activeId` (which board is open) is shared. Naively adopting the remote `activeId` would drag everyone onto whoever saved last. So on a remote apply we keep the viewer's current board active if it still exists.

This is **last-write-wins with live refresh**, not operational-transform/CRDT. It matches the existing personal-sync design and is the right amount of complexity for "everyone can enter and edit the shared canvas."

---

## Code

### 1. Data — one shared state row per canvas module

`prisma/schema.prisma` gets a sibling to `WorkspaceState`, keyed by channel:

```prisma
model ChannelWorkspaceState {
  channelId   String   @id
  channel     Channel  @relation(fields: [channelId], references: [id], onDelete: Cascade)
  data        String   @db.Text            // JSON StoredState (up to 5 boards)
  updatedById String?
  updatedAt   DateTime @updatedAt
}
```

Migration: `prisma/migrations/20260723000000_channel_workspace_state/`.

### 2. API — permission-gated load/save + broadcast

`GET/PUT /api/channels/[id]/workspace` (new). Both call `getChannelPermissions`:

```ts
if (!perms || perms.channelType !== "CANVAS") return 404;
if (!perms.canView) return 403;             // → client shows nothing (skeleton)
// GET returns { data, canEdit: perms.canPost }
// PUT additionally: if (!perms.canPost) return 403;  // read-only can't write
```

The PUT also **re-clamps boards to 5 on the server** (parse JSON, `boards.slice(0, 5)`), then `emitToChannel(channelId, "channel-workspace-updated", { channelId, clientId, updatedAt })`. Because `join-channel` is itself guarded by `canView`, only authorized members are in the room.

### 3. Engine — `WorkspaceCanvas` gains a group mode

New optional props keep the personal behaviour identical when absent:

```ts
remote?: { channelId; loadUrl; saveUrl };  // group-backed persistence + sync
embedded?: boolean;                        // fill the column, not the viewport
title?, subtitle?, onBack?, headerActions?; // header for the module context
```

Derived: `loadUrl/saveUrl` default to `/api/workspace`; `lsKey` becomes `tz-ws-channel:<id>` in remote mode; `readOnly = !!remote && !canEdit` (fed by the GET's `canEdit`). The load effect, save effect (skips when `readOnly` or `skipNextSaveRef`), and socket effect (`join-channel` + `channel-workspace-updated` vs `join-dm` + `workspace-updated`) all branch on `remote`. The header swaps the `/connect` link for an `onBack` button and shows a "Только чтение" badge + a settings-gear slot.

### 4. A thin wrapper — `GroupWorkspacePanel`

```tsx
<WorkspaceCanvas key={channelId} userId={me} userName={myName}
  remote={{ channelId, loadUrl, saveUrl }} embedded
  title={channelName} subtitle="Рабочая среда · совместные холсты"
  onBack={onBack}
  headerActions={canModerate ? <ModuleSettingsButton channelId={channelId}/> : undefined} />
```

### 5. Registering the `CANVAS` type

- `WorkspaceManager` — a new addable module ("Рабочая среда", 🎨).
- `ModulesPanel` — `MODULE_TYPES` + a `META.CANVAS` card (icon/label/tint).
- `ChannelSidebar` — its local `MODULE_TYPES` (so `CANVAS` leaves the flat list and joins the mobile modules block).
- `connect/page.tsx` — `import GroupWorkspacePanel`; a `CANVAS` branch in both the mobile and desktop render switches; and `CANVAS` added to the "show the modules column?" predicate.
- `api/channels` `POST`/`PUT` — `CANVAS` added to the valid-types lists, and `POST` **rejects `CANVAS` in the main community** (`group.isMain → 400`).

---

## Verification

> ⚠️ **Environment caveat (same as recent PRs).** The sandbox blocks Prisma's engine CDN and Google Fonts, so the client was generated in `--no-engine` mode and `next build` can't finish (it fails fetching Inter/Playfair in `layout.tsx`, unrelated to this change).

Green automated checks:

- **Type-check** — `npx tsc --noEmit` → 0 errors.
- **Lint** — `npm run lint` → 0 errors.

**Manual QA (needs Postgres + fonts):**

1. Migrate (`prisma migrate deploy` in `apps/web`).
2. In a **non-main** group, as owner/admin: Group settings → **"Рабочая среда"** → add **"Рабочая среда"** (🎨). Confirm it appears under **"Разделы"**. Confirm the same option is **absent/blocked** in the main "TZ Connect" community.
3. Open it: add cards, create up to 5 boards, confirm the 6th is refused ("до 5 холстов").
4. **Collaboration:** open the same module as two different members in two browsers; edits from one appear for the other within ~1–2 s, and each keeps their own active board.
5. **Access via the gear:** set "кто может редактировать" → *Создатель + модераторы*; a plain member now sees a **"Только чтение"** badge and their changes don't persist. Set "кто может читать" → *только выбранные роли* and pick a role a test member lacks; that member **no longer sees the section at all** (skeletonized). A moderator still sees and edits it.

---

## Alternatives

**A. Build a real-time CRDT (per-object operational sync, à la Figma/Yjs).**

| Pros | Cons |
|------|------|
| True simultaneous editing, no lost updates | Large new dependency + protocol; big surface area |
| No "reload snaps my view" moments | Overkill for a lightweight team canvas |
| Per-object conflict resolution | Weeks of work vs. reusing the proven sync path |

**B. Store each board as its own DB row (`GroupWorkspaceBoard`), not one JSON blob per channel.**

| Pros | Cons |
|------|------|
| Board-level locking / partial updates possible | `WorkspaceCanvas` already manages the multi-board `StoredState` internally — a per-row model fights the engine |
| Smaller diffs per save | Two sources of truth for "how many boards"; more plumbing |
| Natural per-board permissions later | No requirement for it today; the 5-board cap is trivial in one blob |

The chosen design (one JSON blob per channel + reuse the engine + reuse module permissions) is the smallest change that fully meets the brief and stays consistent with the existing personal workspace.

---

## Suggested people to talk to

- **ANDYCOULBOT** (`ANDYCOULBOT@ANDYPC`) — authored `WorkspaceCanvas` (the drawing/canvas engine), `connectPermissions.ts`, and much of the `/connect` shell (`ModulesPanel`, `ChannelSidebar`). The right person to review the canvas parametrization and the permission wiring, since this PR extends their code directly.
- **acoulbot** (`infinitas.vine@gmail.com`) — repo owner who integrated the personal workspace, `WorkspaceManager`, and `ModuleSettingsModal` (PR #336). Best for a high-level check that "collaborative last-write-wins" is the intended fidelity rather than a full CRDT.
- *(The recent `ModulesPanel` mobile fix was AI-authored — low context — so weight ANDYCOULBOT's opinion there.)*

---

## Quiz

<details>
<summary>1. Why implement the group workspace as a new channel <em>type</em> rather than a standalone feature?</summary>

- **A.** It's the only way to store JSON. — *Incorrect.*
- **B. Because module channels already provide the sections panel, the per-section access UI (`ModuleSettingsModal`), and server-side permission checks (`getChannelPermissions`) — so the requested access rules and skeletonization come for free.** — *Correct.*
- **C.** To avoid writing a migration. — *Incorrect; a migration was still added for the state table.*
- **D.** Because voice channels required it. — *Incorrect.*
</details>

<details>
<summary>2. A member lacks the custom role a canvas module is restricted to. What do they experience?</summary>

- **A.** They see the canvas but can't edit. — *Incorrect; that's the read-vs-edit distinction, not a read restriction.*
- **B.** They see an error modal. — *Incorrect.*
- **C. They don't see the section at all — `/api/groups/[id]` filters the restricted channel out of their channel list (skeletonized).** — *Correct. Moderators+ bypass the restriction.*
- **D.** They're removed from the group. — *Incorrect.*
</details>

<details>
<summary>3. What stops two people editing the same board from triggering an endless save↔reload loop?</summary>

- **A.** A server rate-limiter. — *Incorrect.*
- **B.** The 1.2 s debounce alone. — *Incorrect; debounce slows it but wouldn't stop an idle loop.*
- **C. `skipNextSaveRef`: applying state that came from a load or a remote event skips exactly the next save, so only genuine local edits write back.** — *Correct.*
- **D.** Disabling the socket while editing. — *Incorrect.*
</details>

<details>
<summary>4. How is the "up to 5 canvases" limit made tamper-proof?</summary>

- **A.** Only the client checks `MAX_BOARDS`. — *Incorrect; a direct API call could bypass that.*
- **B. The client caps at 5, and `PUT /api/channels/[id]/workspace` re-parses the payload and slices `boards` to 5 server-side.** — *Correct.*
- **C.** A database CHECK constraint. — *Incorrect.*
- **D.** The socket server rejects big payloads. — *Partly (there's a size cap) but that's not the board-count limit.*
</details>

<details>
<summary>5. In group mode, how does a collaborator receive someone else's edits, and why don't they get pulled onto the editor's board?</summary>

- **A.** Polling every second; boards aren't shared. — *Incorrect.*
- **B. They joined `channel-<id>` and receive `channel-workspace-updated`, then refetch; on apply, the viewer's current `activeId` is preserved if that board still exists.** — *Correct.*
- **C.** The server pushes a diff and rebases locally. — *Incorrect; it's a full refetch, not a diff.*
- **D.** They must reload the page. — *Incorrect; it's live via socket.io.*
</details>
