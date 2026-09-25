# Tsuji fork of Suwayomi-WebUI: handoff

Everything a new session needs to continue this fork. The fork adds a small set of reading features (a web port of
the owner's Makimono Android fork) to Suwayomi-WebUI and is served by the owner's Suwayomi-Server as the **Custom**
WebUI flavor. Current plan and last execution report: [PLAN.md](PLAN.md).

## State (2026-09-25)

| Branch                    | Commit                          | What                                                                                    |
| ------------------------- | ------------------------------- | --------------------------------------------------------------------------------------- |
| `custom`                  | `d78289ca` (r3380)              | Stable tag `v20260726.01` (WebUI r3379) + WebUI brief #1. Deployed on the server.       |
| `feat/anilist-seen-speed` | `39c1ca52` WIP + docs/CI commit | WebUI brief #2, built and checked against the server as r3381. **Not on `custom` yet.** |
| `master`                  | upstream                        | Untouched mirror of Suwayomi/Suwayomi-WebUI. Never push to it.                          |

Server: Suwayomi-Server **v2.3.2243 Stable** (needs WebUI r3379-compatible queries), flavor Custom.
Remotes: `origin` = Tsuji-Hub/Suwayomi-WebUI (public fork), `upstream` = Suwayomi/Suwayomi-WebUI.

## Open items

1. **Brief #2 is pending the owner's on-server check.** After the OK: squash or keep the WIP commit, fast-forward
   `custom` to `feat/anilist-seen-speed`, push `custom`. Do not merge before that.
2. **Deploy r3381 and verify it** (done by Cowork, not by the coding session): use the CI prerelease zip for
   `feat/anilist-seen-speed` or a local `pnpm build`; rotate the current server folder to `webUI.r3380` first.
   Acceptance list: PLAN.md, "Acceptance".
3. Brief #3: **For You** tab (taste profile + weekly rotation). A stub tab exists in Discover.
4. **Blocker before any HTTPS / secure-context setup:** Firefox with a secure-context allowlist for the server
   registers the PWA service worker, and upstream's `image-cache-manga-thumbnails` CacheFirst route then fails
   library covers with `NS_ERROR_INTERCEPTION_FAILED`. Fix or scope the SW image routes (`vite.config.ts`
   `runtimeCaching`) first. Not changed so far on purpose.
5. Later option: write marks to AniList (status/progress) instead of `tsuji_seen`. Needs AniList OAuth in the
   browser.
6. External APIs: Jikan (MAL) returned 504 through 2026-09-24/25 (Similar degrades to AniList-only). AniList runs
   in a degraded mode (30 req/min; latency 0.3-10 s; TRENDING_DESC / START_DATE_DESC and `format_not_in` /
   `isAdult` intermittently return empty pages). The client handles all of it; see PLAN.md.

## Rules (non-negotiable)

- **Base = stable tag, never upstream master.** Master needs server r2320+ (see `versionToServerVersionMapping.json`);
  its queries fail on v2.3.2243 (e.g. `aboutServer.platformInfo`). Sync by rebasing `custom` onto the next stable
  tag that matches the server.
- All new code under `src/features/tsuji/**`. Upstream files get one-line hooks only (list below). No methods added
  to `src/lib/requests/RequestManager.ts`. External calls (AniList, Jikan) use `fetch`, never Apollo.
- Upstream conventions: `@/` imports with extensions, MUI `sx`/`styled` (no `style` prop), every user-facing string
  through Lingui, MPL-2.0 header on new files, oxlint + oxfmt clean, `pnpm tsc` clean. Let the husky hook run.
- Metadata: raw `tsuji_*` keys only (upstream migrations delete unregistered `webUI_*` keys). Global:
  `tsuji_libraryProgressBadge`, `tsuji_readerChapterProgress`, `tsuji_recFilters`, `tsuji_anilistUser`,
  `tsuji_seen`. Manga: `tsuji_anilistId`. Write through upstream's metadata updater with `isMetadataKey: true`.
- Ranking uses **Makimono's shipped constants** (RecommendationRanker.kt), not the brief #1 draft numbers.
- `src/lib/graphql/generated/*` and `src/i18n/locales/*.po` are tool output: regenerate (`pnpm codegen:offline` or
  `pnpm gql:codegen`, then `oxfmt` them; `pnpm i18n:extract`), never hand-merge.
- Features go on `feat/**` off `custom`; commits wait for the owner's server check; `--force-with-lease` only with an
  explicit go. Never push `master`.

## Upstream touch list (12 files)

| File                                                                     | Hook                                                                        |
| ------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `gql_codegen.ts`                                                         | documents glob includes `src/features/tsuji/graphql/**`                     |
| `src/lib/graphql/manga/MangaFragments.ts`                                | spreads `TSUJI_MANGA_PROGRESS_FIELDS` into `MANGA_LIBRARY_FIELDS`           |
| `src/features/manga/components/MangaBadges.tsx`                          | `children` slot after the unread badge                                      |
| `src/features/manga/components/cards/MangaCard.tsx`                      | passes `<TsujiProgressBadge>` into `MangaBadges`                            |
| `src/features/library/components/LibraryOptionsPanel.tsx`                | progress-badge toggle under Badges                                          |
| `src/features/manga/components/details/MangaDetails.tsx`                 | series progress line + Similar section                                      |
| `src/features/reader/overlay/navigation/desktop/ReaderNavBarDesktop.tsx` | "Ch. 21 / 200" under the chapter picker                                     |
| `src/features/reader/settings/general/ReaderGeneralSettings.tsx`         | reader progress toggle                                                      |
| `src/App.tsx`                                                            | Discover route (lazy)                                                       |
| `src/base/AppRoute.constants.ts`                                         | `discover` route constant                                                   |
| `src/features/navigation-bar/NavigationBar.constants.ts`                 | Discover nav item (desktop sidebar, More on mobile)                         |
| `src/features/app-updates/components/WebUIUpdateChecker.tsx`             | wrapper: mount only after server settings load, never for Custom (brief #2) |

Also changed: `package.json` (vitest devDependency, `test:tsuji`, `codegen:offline`), `pnpm-lock.yaml`. Added at the
root: `gql_codegen.offline.ts`. Added: `docs/tsuji/**`, `.github/workflows/tsuji-release.yml`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm tsc
pnpm test:tsuji            # vitest, src/features/tsuji/**/*.test.ts
pnpm build                 # output in build/
pnpm codegen:offline       # types from docs/tsuji/schema.graphql, no server needed
pnpm i18n:extract          # en.po only
```

Offline codegen is byte-identical to live codegen against v2.3.2243 (run `oxfmt --write` on the three generated
files afterwards, as the commit hook would). Refresh `docs/tsuji/schema.graphql` from the server's introspection when
the server is upgraded (and keep custom-scalar descriptions out of it, or the generated comments drift).

## CI and releases

`.github/workflows/tsuji-release.yml` runs on every push to `custom` and `feat/**`: install, lint, tsc, `test:tsuji`,
build, zip `build/` like `pnpm build-zip` (with a `revision` file), then publishes a GitHub release tagged
`r<commit count>-<short sha>` with the zip and a `.sha256` file. `feat/**` builds are prereleases.

## Deploy (Cowork, not the coding session)

- The server serves `<dataRoot>/webUI/` when the WebUI flavor is **Custom** and then skips WebUI update checks.
  It copies that folder at startup, so every new build needs a container restart.
- Keep rollback copies: the stock UI is in `webUI.stock-r3379`; rotate the current build to `webUI.r<rev>` before
  copying a new one. Cowork's script: `Homelab_SuwayomiWebUI_Deploy_v1.sh` (in the owner's Cowork outputs).
- Build output is `build/` (not `dist/`); `revision` must contain `r<commit count>`.

## Local Windows builds (if work returns to the owner's machine)

- Keep the pnpm store on the system drive: the project drive once wrote NUL-filled files into a store and broke a
  build. Scan `build/` for NUL-filled files before handing a build off.
- pnpm 11 with a store on another drive can fail `install` with `UNKNOWN: ... symlink ... projects\<hash>`; rename
  that stale entry to a dot-name and retry.
- No `zip` on Windows: use `7z a -tzip -mx=9` for the build zip.
