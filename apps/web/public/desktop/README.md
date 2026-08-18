# Self-hosted desktop installers

This directory is the **download store** for the TZ.Connect desktop client. The
web app serves everything here from two places, and **neither touches GitHub**:

- `GET /api/download/desktop` — the `/about` "Скачать десктоп-версию" button.
  With `?os=windows|mac|linux` it streams the matching installer straight to the
  browser (`Content-Disposition: attachment`), so the download starts
  immediately. Without `?os=` it returns JSON metadata (`available`, `version`,
  per-platform availability).
- `GET /desktop/<file>` — static serving (with HTTP range support) for direct
  links and for the Electron auto-updater / `nsis-web` stub, which fetch
  `latest*.yml`, `*.blockmap` and the `*.7z` app package from here. This matches
  electron-builder's `publish.url` (`https://trioz.ru/desktop/`).

## How to publish a build

For a self-updating release (auto version + build + publish in one step):

```bash
# pm2 / git deploy — build the current OS's installer with a strictly-newer
# version (0.<minor>.<commit-count>) and publish it here, cleaning the old one:
npm run desktop:release

# Docker / compose — same, but into the desktop_data volume the container serves:
npm run desktop:release:docker
```

Or the individual steps:

```bash
# 1. Build the installers for the current OS (repeat per platform / in CI).
#    :auto stamps 0.<minor>.<commit-count> so every build is strictly newer;
#    plain :dist keeps package.json's frozen version (fine for local testing):
npm run desktop:dist:auto

# 2a. Local dev — copy electron-builder output (apps/desktop/release/*) into
#     this directory in the repo checkout (--clean removes the previous build):
npm run desktop:publish -- --clean

# 2b. Docker/prod — copy them straight into the desktop_data volume the running
#     container serves from (needs Docker + the compose stack):
npm run desktop:publish:docker
```

> ⚠️ `electron-updater` only offers an update when the feed's version is
> **strictly greater** than the installed one. A rebuild that keeps the same
> version (plain `npm run desktop:dist`, frozen at `package.json`) will **not**
> auto-update anyone — use `:auto` / `desktop:release`, which derive the version
> from the git commit count.

`desktop:publish` copies installers (`.exe`, `.dmg`, `.zip`, `.AppImage`,
`.deb`), the update feeds (`latest*.yml`), block maps and the `nsis-web`
package (`*.7z`) here. Build Windows installers on Windows, macOS on macOS and
Linux on Linux (or use the `Build desktop installers` GitHub Action and drop its
artifacts here).

> **Why two commands?** In Docker this directory *inside the container* is the
> `desktop_data` volume — a different place from `apps/web/public/desktop` in
> your repo checkout on the host. So `desktop:publish` (which writes into the
> checkout) never reaches the volume the app actually serves from.
> `desktop:publish:docker` runs the one-shot `desktop-publish` compose service,
> which mounts the very same `desktop_data` volume and copies the installers
> there. It also cleans out the previous build first (`DESKTOP_PUBLISH_CLEAN`),
> so a version bump doesn't leave two installers behind. The download route is
> `force-dynamic`, so the new files show up on the next request — no restart.

Under the hood both commands run the same `scripts/publish-desktop.mjs`; the
source and destination directories are overridable via `DESKTOP_RELEASE_DIR` and
`DESKTOP_DOWNLOAD_DIR`.

## Expected file names

electron-builder stamps the version into each name, e.g.:

```
TrioZ Connect Setup 0.1.0.exe        # Windows, standalone (offline) — preferred
TrioZ Connect Web Setup 0.1.0.exe    # Windows, nsis-web online stub
TrioZ Connect-0.1.0.dmg              # macOS
TrioZ Connect-0.1.0.AppImage         # Linux
trioz-connect_0.1.0_amd64.deb        # Linux
latest.yml / latest-mac.yml / latest-linux.yml
```

The download route matches by **extension**, not exact name, so version bumps
need no code changes.

## Where installers may be placed

This directory (`apps/web/public/desktop`) is the **canonical** store and always
wins. For resilience the app also discovers an installer dropped into a
neighbouring `public/` folder, searched in this order:

1. `$DESKTOP_DOWNLOAD_DIR` (if set) — pin an exact folder
2. `<cwd>/public/desktop` — **canonical** (here)
3. `<cwd>/public` — the web app's public root
4. `<monorepo-root>/public/desktop`
5. `<monorepo-root>/public` — e.g. `/var/www/trioz/public`
6. `<monorepo-root>/apps/desktop/release` — electron-builder's output dir, so a
   fresh build is served even before it's published here (lowest priority)

Only installer files (`.exe/.dmg/.zip/.AppImage/.deb`), the `latest*.yml` feed,
`.blockmap`s and the nsis-web `.7z` are ever listed or served, so ordinary
public assets (icons, `robots.txt`, …) are never mistaken for a build. Keeping
everything in this directory is still preferred: the electron auto-updater and
the nsis-web stub fetch their companion files (`latest*.yml`, `.blockmap`,
`.7z`) from `/desktop/`, so a full release should live together here.

## Deployment

In Docker this folder is a **persistent volume** (`desktop_data`, mounted at
`/app/apps/web/public/desktop`), so published installers survive redeploys just
like user uploads. Override the location with the `DESKTOP_DOWNLOAD_DIR`
environment variable.

Publish into that volume with `npm run desktop:publish:docker` (equivalently
`docker compose --profile publish run --rm desktop-publish`). The GitLab deploy
job runs the same step automatically after `docker-compose up -d app` whenever
`apps/desktop/release/` contains freshly built installers, so a deploy that
carries new artifacts refreshes the volume on its own.
