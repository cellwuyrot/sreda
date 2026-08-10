# Explainer — Smarter notifications, instant badges, a group menu, cross-device `/workspace`, and Discord-style community folders

> 🎯 **TL;DR** — This change applies the `tz-connect-update2` package to TZ.Connect. Five user-visible problems get fixed at once:
>
> 1. **You got pinged for a channel you were already looking at.** The server created a mention notification without checking whether the recipient was currently watching that channel.
> 2. **Unread badges and the bell were laggy.** They only refreshed on a 60-second poll, so a channel you had just read kept glowing.
> 3. **Group settings were scattered.** A gear icon plus a loud standalone "Leave community" button. Now the group *name* is a button that opens one tidy menu.
> 4. **`/workspace` boards didn't sync** between the web app and the Electron desktop client, because state lived only in each client's `localStorage`.
> 5. **The community list couldn't be reordered**, and there were no folders.
>
> The fixes: a socket-backed *presence* check before creating a mention; a `channel-read` event that clears badges everywhere instantly; a self-contained `GroupHeaderMenu`; a server-owned `/api/workspace` store with live socket sync; and a drag-and-drop `GroupListPanel` backed by `/api/groups/layout`.

---

## Background

### For newcomers: how TZ.Connect is wired

TZ (TrioZ) is an npm-workspaces **monorepo**. The user-facing app is a Next.js project in `apps/web`, but it is **not** served by the stock `next start`. Instead, a custom server — `apps/web/server.ts` — wraps Next.js *and* runs a **Socket.IO** server on the same HTTP listener (path `/api/socketio`). Every real-time feature (typing indicators, DM presence, voice, notification badges) flows over that one socket.

Two Socket.IO conventions matter for this change:

> 📌 **Definition — the personal room.** On connect, every authenticated socket is joined to a room named `dm-<userId>` (see `server.ts`). Server code can therefore push an event to *all* of a user's devices/tabs at once via the helper `emitToUser(userId, event, data)` in `src/lib/socketEmit.ts`, which emits to that room.

> 📌 **Definition — the channel room.** While a user has a text channel open, their socket is in the room `channel-<channelId>`. Server code emits new messages there with `emitToChannel(channelId, ...)`. This room is the key to the presence fix: *membership of `channel-<id>` is a live signal of "who is looking at this channel right now."*

Data lives in Postgres behind **Prisma**. The web app runs on a schema in `apps/web/prisma/schema.prisma`; changes ship as SQL files under `prisma/migrations/` and are applied in production by `prisma migrate deploy` (wired into `postinstall`).

### The five problem areas, narrowly

**Notifications.** `POST /api/messages` parses `@mentions`, and for each mentioned member who hasn't muted the channel it calls `createNotification(...)`. There was no check for whether the recipient was *currently viewing* the channel — so being in a channel and getting mentioned still produced a bell notification and an unread badge.

**Badges.** The Connect page (`src/app/connect/page.tsx`) tracked `unreadCounts` and `mentionChannels` and refreshed them by polling `/api/channels/unread` **every 60 seconds**. Opening a channel didn't proactively clear its badge, and there was no cross-device signal, so a channel read on your phone stayed "unread" on your laptop for up to a minute. The navbar bell (`src/components/ui/Navbar.tsx`) had the same lag.

**Group header.** `ChannelSidebar.tsx` rendered the group name as plain text, a mute **bell** button, and — for managers — a **gear** button, plus a separate bright red "Покинуть сообщество" button above the header.

**Workspace.** `WorkspaceCanvas.tsx` persisted all boards to `localStorage` under `tz-workspace-v1:<userId>`. The browser and the Electron shell have *different* `localStorage`, so boards never crossed the divide.

**Community list.** `GroupListPanel.tsx` rendered a flat, fixed-order list with no drag-and-drop and no folders.

---

## Intuition

### Presence: "are you already here?"

The core realization is that the socket layer *already knows* who is looking at a channel — those sockets are sitting in the room `channel-<id>`. So before creating a mention notification, we just ask: *is any socket belonging to this user in that room?*

```
Alice opens #general      → her socket joins room "channel-general"
Bob types "@Alice hi"     → POST /api/messages
   server: is Alice in "channel-general"? → YES → skip the notification
Alice is on #random       → her socket is NOT in "channel-general"
Bob types "@Alice hi"     → server: is Alice there? → NO → create notification
```

Because the check runs inside `server.ts` (where the Socket.IO instance lives) but the *caller* is a Next.js API route (a different module), we bridge them with a global function `__isUserInChannel`, wrapped by a tiny typed helper `isUserViewingChannel(userId, channelId)` in `src/lib/presence.ts`.

### Instant badges: tell every device the moment a channel is read

Two moves. First, **optimism**: the instant you click a channel, delete its entry from `unreadCounts`/`mentionChannels` locally — don't wait for a poll. Second, **broadcast**: when the server records that you opened a channel (the `lastRead` write in `GET /api/messages`), it also marks that channel's notifications read and emits `channel-read` to your personal room. Every tab and the desktop client hears it and clears the same badge. The poll interval drops from 60 s to 15 s as a safety net, and also fires when a hidden tab becomes visible again.

### Workspace sync: promote the server to source of truth

`localStorage` becomes an *offline cache*, and the database becomes the truth. On load, read `/api/workspace` first and fall back to `localStorage` only if the server is unreachable. On change, write `localStorage` immediately (fast) and debounce a `PUT /api/workspace` (1.2 s). The `PUT` emits `workspace-updated` to your personal room; other devices refetch and re-apply.

> ⚠️ **Edge case — echo suppression.** Your own `PUT` would bounce `workspace-updated` right back at you and could clobber in-progress edits. Each client mints a random `clientId`; the event carries the saver's `clientId`, and a device ignores events that carry *its own* id. Conflict resolution is deliberately simple: **last write wins**.

### Folders: a personal layout laid over the group list

The set of communities you belong to is server data, but *how you arrange them* is a personal view. That arrangement is stored separately in `/api/groups/layout` as a small JSON document: an ordered list whose items are either a `group` or a `folder` (a named, collapsible bag of group ids). The panel always **normalizes** the stored layout against your live membership — dropping communities you've left, appending ones you've joined, and dissolving any folder that has fewer than two members.

---

## Code

### 1. New Prisma models + migration

Two one-row-per-user tables, each a JSON blob plus an `updatedAt`:

```prisma
model WorkspaceState {
  userId    String   @id
  data      String   @db.Text
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}

model GroupLayout {
  userId    String   @id
  data      String   @db.Text
  updatedAt DateTime @updatedAt
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
}
```

Plus the two back-relations on `model User` (`workspaceState`, `groupLayout`) and a new migration, `20260713120000_workspace_sync_and_group_layout`, that creates both tables with a `userId` primary key and a cascading FK to `User`.

### 2. Presence bridge (`server.ts` + `src/lib/presence.ts`)

`server.ts` installs a global, right after the `__kickVoiceChannel` block:

```ts
(globalThis as Record<string, unknown>).__isUserInChannel = async (
  userId: string,
  channelId: string
): Promise<boolean> => {
  try {
    const sockets = await io.in("channel-" + channelId).fetchSockets();
    return sockets.some((s) => authenticatedSockets.get(s.id)?.userId === userId);
  } catch {
    return false;
  }
};
```

`presence.ts` is the typed, dependency-free wrapper that API routes import. If the global isn't installed yet (e.g. during a cold boot), it safely returns `false`.

### 3. Notifications (`src/app/api/messages/route.ts`)

`POST` now guards `createNotification` with the presence check; `GET` clears the channel's notifications and broadcasts `channel-read`:

```ts
// POST: skip the ping if the recipient is already in the channel
const viewing = await isUserViewingChannel(mentionedId, channelId);
if (!viewing) { createNotification({ /* … */ }).catch(() => {}); }

// GET: after updating lastRead
await prisma.notification.updateMany({
  where: { userId: session.user.id, read: false, link: { contains: "channel=" + channelId } },
  data: { read: true },
});
emitToUser(session.user.id, "channel-read", { channelId });
```

### 4. Instant badges (`connect/page.tsx` + `Navbar.tsx`)

`handleChannelClick` optimistically deletes the badge; a new `channel-read` socket listener clears it on every device; the poll drops to 15 s and also runs on `visibilitychange`. The navbar bell recomputes its count on `channel-read`:

```ts
socket.on("channel-read", () => loadUnread());
```

### 5. Group menu (`GroupHeaderMenu.tsx` + `ChannelSidebar.tsx`)

The new `GroupHeaderMenu` renders the group name as a button that opens a dropdown with members, invite, create-channel, settings (managers only), a mute toggle it manages itself via `/api/channels/mute`, and — for non-owners of non-main communities — a quiet, confirm-on-second-click "Leave community." In `ChannelSidebar.tsx` the standalone leave button, the mute bell, and the gear were removed and replaced by this one component. (The now-unused `handleToggleGroupMute` and the `BellIcon` import were deleted.)

### 6. Workspace sync (`WorkspaceCanvas.tsx`)

The state-application logic was extracted from the load effect into `applyStored(stored)`. The load effect now tries the server first, then `localStorage`. The save effect writes `localStorage` immediately and debounces a `PUT`. A new effect opens a socket and re-applies state on `workspace-updated` (ignoring its own `clientId`). The server store lives in `src/app/api/workspace/route.ts`.

### 7. Community folders (`GroupListPanel.tsx` + `src/app/api/groups/layout/route.ts`)

`GroupListPanel.tsx` was replaced wholesale (props unchanged, so `connect/page.tsx` needed no edits). It implements pointer-based drag-and-drop: drop one community on another to make a folder, click a folder to collapse/expand, double-click its name to rename, and drag in/out of folders. The layout is normalized against live membership and debounce-saved to `/api/groups/layout`.

---

## Verification

Because this sandbox has **no outbound network**, two build inputs can't be downloaded here: the Prisma engine binaries and the Google Fonts used by `next/font`. Everything that does *not* require the network was run and passed:

- ✅ **Prisma client generation** — generated with `engine=none` (schema parsed by the bundled schema-wasm), so the client's TypeScript types include the new `WorkspaceState` and `GroupLayout` models.
- ✅ **TypeScript** — `tsc --noEmit` over the whole `apps/web` project: **0 errors**, using the freshly generated client types.
- ✅ **ESLint** — `eslint src/`: **0 errors** (only pre-existing warnings; the sole warning from this change is the `Math.random()` inside a `useRef` initializer, which is the exact code specified by the update package and is warning-only).
- ⚠️ **`next build`** — cannot complete here: it fails while fetching `Inter` / `Playfair Display` from Google Fonts and (separately) the Prisma engine. Both are environmental, not code issues. CI/deploy, which has network access, will build normally.

### Manual QA guide (after deploy)

1. Open a channel and have another user @-mention you **in that channel** → no notification appears.
2. Have them @-mention you in a **different** channel → the bell + badge appear; open that channel and watch the badge and bell clear **immediately**, including on a second device.
3. Click a group **name** → managers see the full menu; regular members see members/mute/leave (leave needs a confirming second click). The old red leave button and the gear are gone.
4. Create a board in `/workspace` in the browser → it appears in the desktop client without a reload (and vice-versa).
5. Drag a community up/down → order persists across reload and on another device.
6. Drop one community onto another → a folder forms; click collapses/expands; double-click renames; if a folder is left with one community it dissolves.

---

## Alternatives

### Presence check: socket rooms vs. a heartbeat/`lastSeen` column

| Chosen: query the `channel-<id>` socket room | Alternative: persist a "currently viewing" heartbeat in the DB |
|---|---|
| ✅ Zero new storage; the room membership already exists | ✅ Survives across processes without a shared socket layer |
| ✅ Always current — reflects reality this instant | ✅ Queryable by any service, not just the socket server |
| ❌ Relies on the global bridge; only meaningful in-process | ❌ Extra writes on every focus change; staleness/expiry logic |
| ❌ Single-server assumption (no cross-node room federation) | ❌ More moving parts for a simple "is she looking?" question |

### Workspace sync: last-write-wins snapshot vs. CRDT/OT merge

| Chosen: whole-document snapshot, last write wins | Alternative: CRDT or operational transform per-card |
|---|---|
| ✅ Trivial to reason about and implement | ✅ Concurrent edits on two devices merge without loss |
| ✅ One row, one blob, one debounced PUT | ✅ Real collaborative editing becomes possible |
| ❌ Simultaneous edits on two devices: later save wins, the other is lost | ❌ Substantial complexity; needs per-object identity and merge rules |
| ❌ Not true multiplayer | ❌ Overkill for a single user's own devices |

---

## Suggested people to talk to

Almost every file touched here (`connect/page.tsx`, `WorkspaceCanvas.tsx`, `ChannelSidebar.tsx`, `Navbar.tsx`, `messages/route.ts`) was authored by the **`Claude` AI committer** in prior updates, so there isn't a deep human owner to consult on most of it — review the code on its own merits rather than assuming tribal knowledge exists.

The one thread worth pulling: the commit *"fix(critical): 5 багов — IDOR уведомлений, права в группах…"* (committer email `citiesofearthintheworld2050+…@gmail.com`) previously reworked **notification/IDOR** behaviour and touched `server.ts`. Whoever drove that change is the closest thing to a subject-matter expert on the notification model and the socket-authentication map (`authenticatedSockets`) that the presence check relies on — a good person to sanity-check the `channel-read` broadcast and the `link: { contains: "channel=" }` matching.

(The `freedomsoftware` contributor's recent edit to `connect/page.tsx` was a *theme* change — removing "Velvet", adding "Монохром" — unrelated to notifications or the group list, so probably not a useful contact for this PR.)

---

## Quiz

<details>
<summary><strong>1. Why does the mention notification check the <code>channel-&lt;id&gt;</code> socket room instead of a database field?</strong></summary>

- **A.** Because socket rooms are encrypted. — *Incorrect; rooms aren't an encryption feature.*
- **B.** Because membership of that room is a live, zero-cost signal of who is looking at the channel right now. — ✅ **Correct.** The sockets in `channel-<id>` already represent open viewers, so no new storage or heartbeat is needed.
- **C.** Because the database has no notification table. — *Incorrect; `Notification` exists and is used.*
- **D.** Because Prisma can't do `updateMany`. — *Incorrect; `GET` uses exactly that.*
</details>

<details>
<summary><strong>2. What stops your own <code>PUT /api/workspace</code> from triggering a wasteful self-refresh (or clobbering your edits)?</strong></summary>

- **A.** A server-side lock per user. — *Incorrect; there's no lock.*
- **B.** The client only listens for events while the tab is hidden. — *Incorrect; it always listens.*
- **C.** Each client mints a random `clientId`; the `workspace-updated` event carries the saver's id and a device ignores events bearing its own id. — ✅ **Correct.**
- **D.** The event is only sent to *other* users. — *Incorrect; it's sent to the saver's own `dm-<userId>` room too; the `clientId` filter is what discriminates.*
</details>

<details>
<summary><strong>3. A folder with exactly one community inside it is dropped and now has one member. What happens?</strong></summary>

- **A.** It stays as a one-item folder. — *Incorrect.*
- **B.** `normalize`/`applyDrop` dissolves it back into a plain group entry (folders require ≥ 2). — ✅ **Correct.** Both the normalizer and the drop handler collapse sub-two-member folders.
- **C.** The community is deleted. — *Incorrect; membership is never changed by layout.*
- **D.** The app throws. — *Incorrect.*
</details>

<details>
<summary><strong>4. Why did <code>connect/page.tsx</code> need no changes when <code>GroupListPanel.tsx</code> was replaced, but <code>ChannelSidebar.tsx</code> did change?</strong></summary>

- **A.** `GroupListPanel`'s props are unchanged, so it's a drop-in; `ChannelSidebar` had to swap its header markup for the new `GroupHeaderMenu`. — ✅ **Correct.**
- **B.** `connect/page.tsx` doesn't import `GroupListPanel`. — *Incorrect; it does, but the interface is stable.*
- **C.** `ChannelSidebar` is a server component. — *Incorrect; it's a client component.*
- **D.** Because folders are stored in `connect/page.tsx`. — *Incorrect; they're stored server-side via `/api/groups/layout`.*
</details>

<details>
<summary><strong>5. The badge clears the instant you click a channel, before any network round-trip. Which mechanism does that, and what backs it up?</strong></summary>

- **A.** The 15 s poll does it alone. — *Incorrect; the poll is the backstop, not the instant part.*
- **B.** `handleChannelClick` optimistically deletes the channel's entry from `unreadCounts`/`mentionChannels`; the server's `channel-read` broadcast (plus the poll) reconciles across devices. — ✅ **Correct.**
- **C.** The server clears it synchronously in the click handler. — *Incorrect; the click handler is client-side and local.*
- **D.** `localStorage` holds the unread state. — *Incorrect; unread state is React state fed by `/api/channels/unread`.*
</details>
