# Tsuji fork of Suwayomi-WebUI: handoff

Everything a new session needs to continue this fork. The fork adds a small set of reading features (a web port of
the owner's Makimono Android fork) to Suwayomi-WebUI and is served by the owner's Suwayomi-Server as the **Custom**
WebUI flavor. Current plan and last execution report: [PLAN.md](PLAN.md).

## State (2026-10-20)

| Branch              | Commit             | What                                                                                                                            |
| ------------------- | ------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| `custom`            | `b3055a98` (r3416) | Briefs #1-#9 (tag search on MangaBaka, preview Comments / Reviews) + reader resume, schema v2.4.2366. Shipped 2026-10-20, live. |
| `feat/chapter-bell` | this               | Brief #10: new-chapter bell in the app bar (replaces the Discord chapter pings), incl. `chore/docs-r3416`. Prerelease to check. |
| `master`            | upstream           | Untouched mirror of Suwayomi/Suwayomi-WebUI. Never push to it.                                                                  |

Server: Suwayomi-Server **v2.4.2366** (upgraded 2026-10-19 from v2.3.2243; r3401 verified on it 2026-10-20), flavor
Custom. MangaFire is gone (library on Atsumaru, Comix, ...); 32 raw sources (KR/JP/CN) installed, linked and
machine-translated by server-side jobs (rawfinder, mtl-engine on VM110; brief #6 v2). Phone passes and phone UX are
optional: the owner reads on the desktop / projector only.
Remotes: `origin` = Tsuji-Hub/Suwayomi-WebUI (public fork), `upstream` = Suwayomi/Suwayomi-WebUI.

## Open items

1. **Reader resume: done** (r3389, verified live 2026-09-27: offset [5, 0.557], F5 and double F5 land within ~4 px
   on the same page, no pull-back, lastPageRead only rises). Webtoon / continuous vertical only. History: PLAN.md,
   "Fix: webtoon resume lands short". r3388/r3389 came from a second thread; this thread owns the fork.
2. **For You: done** (r3391, verified live 2026-09-28 against real AniList: 3 calls, all 200, the 4-seed batch
   without retry; 0 calls on reload; no started/completed/dropped titles in the top picks). PLAN.md, "Brief #3".
3. The server runs r3416 (briefs #4-#9). Older note: release `r3383-eb23a8e3` has a stale sha256 in its notes (its
   `.sha256` asset is right); the workflow no longer rebuilds an existing tag.
4. Brief #4: **duplicate chapters** shipped 2026-10-15 (r3392 on `custom`; PLAN.md, "Brief #4").
5. **Parked (owner: low priority):** paged reading modes follow the route state on F5 and have no in-page offset;
   the service-worker image cache below. **The SW item is still a blocker before any HTTPS / secure-context
   setup:** Firefox with a secure-context allowlist for the server registers the PWA service worker, and upstream's
   `image-cache-manga-thumbnails` CacheFirst route then fails library covers with `NS_ERROR_INTERCEPTION_FAILED`.
   Fix or scope the SW image routes (`vite.config.ts` `runtimeCaching`) first.
6. Later option: write marks to AniList (status/progress) instead of `tsuji_seen`. Needs AniList OAuth in the
   browser.
7. Comments relay: runs next to Suwayomi on CT100, port 4568 (not in this repo); it also serves the MTL action feed
   `/mtl/raws.json` and the pre-signed translate / cancel pages (brief #6), and proxies MangaDex
   (`/mangadex/`) for brief #8. Its `/mangaupdates/` route is retired (brief #9 calls MangaBaka directly).
   MangaBaka's Cloudflare answers 403 to a "HeadlessChrome" User-Agent: a live browser test against
   `api.mangabaka.org` must set a normal Chrome UA (the mocked e2e is unaffected). The WebUI calls
   `${tsuji_commentsRelay}/comick/...`; unset means the WebUI's own host on port 4568, so no address is in the bundle.
8. External APIs: Jikan (MAL) returned 504 through 2026-09-24/25 (Similar degrades to AniList-only). AniList runs
   in a degraded mode (30 req/min; latency 0.3-10 s; TRENDING_DESC / START_DATE_DESC and `format_not_in` /
   `isAdult` intermittently return empty pages). The client handles all of it; see PLAN.md.

## Rules (non-negotiable)

- **Base = stable tag, never upstream master.** `custom` is on `v20260726.01` (WebUI r3379, made for server r2243);
  it runs on the server's v2.4.2366 (r2366). Upstream now has `v20260929.01` (r3518, server r2320) and its PREVIEW
  targets r2366. Sync by rebasing `custom` onto the next stable tag that matches the server, only on the owner's go.
- All new code under `src/features/tsuji/**`. Upstream files get one-line hooks only (list below). No methods added
  to `src/lib/requests/RequestManager.ts`. External calls (AniList, Jikan) use `fetch`, never Apollo.
- Upstream conventions: `@/` imports with extensions, MUI `sx`/`styled` (no `style` prop), every user-facing string
  through Lingui, MPL-2.0 header on new files, oxlint + oxfmt clean, `pnpm tsc` clean. Let the husky hook run.
- Metadata: raw `tsuji_*` keys only (upstream migrations delete unregistered `webUI_*` keys). Global:
  `tsuji_libraryProgressBadge`, `tsuji_readerChapterProgress`, `tsuji_recFilters`, `tsuji_anilistUser`,
  `tsuji_similarLayout`, `tsuji_comments`, `tsuji_commentsComick`, `tsuji_commentsRelay`, `tsuji_commentsMatch`,
  per device preset `tsuji[_<device>]_pagePosition` and `tsuji[_<device>]_pageEdgeOffset` (brief #7),
  read-only manga meta `tsuji_raw_links` (written daily by the server's rawfinder / mtl-engine; never written here),
  marks in `tsuji_seen_0` .. `tsuji_seen_15` (legacy `tsuji_seen` is migrated, then deleted), the chapter bell's
  watermarks in `tsuji_bell_0` .. `tsuji_bell_15` (`{"<mangaId>": highest number seen}`), `tsuji_bellCategories`
  (watched category ids) and `tsuji_bellStart` (first run, brief #10). Manga:
  `tsuji_anilistId`, `tsuji_readScanlator` (JSON scanlator last finished in the reader: duplicate chapters' Resume
  copy). Write through upstream's metadata updater with `isMetadataKey: true`, except read-patch-write values (marks
  shards, bell shards, `tsuji_commentsMatch`): they go through `writeTsujiRawGlobalMeta` (upstream's chunk cleanup
  would treat `tsuji_seen_<n>` as chunks of `tsuji_seen`; never write a bare `tsuji_bell` key for the same reason).
- Global meta values are capped at 4096 chars by the server. Anything that grows with use must be sharded (see
  `seen/seenShards.ts`: bucket = mediaId % 16, refuse past 3800 chars with a visible error).
- Ranking uses **Makimono's shipped constants** (RecommendationRanker.kt), not the brief #1 draft numbers.
- `src/lib/graphql/generated/*` and `src/i18n/locales/*.po` are tool output: regenerate (`pnpm codegen:offline` or
  `pnpm gql:codegen`, then `oxfmt` them; `pnpm i18n:extract`), never hand-merge.
- Features go on `feat/**` off `custom`; commits wait for the owner's server check; `--force-with-lease` only with an
  explicit go. Never push `master`.

## Upstream touch list (26 files)

| File                                                                                                 | Hook                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `gql_codegen.ts`                                                                                     | documents glob includes `src/features/tsuji/graphql/**`                                                                                                                       |
| `src/lib/graphql/manga/MangaFragments.ts`                                                            | spreads `TSUJI_MANGA_PROGRESS_FIELDS` into `MANGA_LIBRARY_FIELDS`                                                                                                             |
| `src/features/manga/components/MangaBadges.tsx`                                                      | `children` slot after the unread badge                                                                                                                                        |
| `src/features/manga/components/cards/MangaCard.tsx`                                                  | passes `<TsujiProgressBadge>` into `MangaBadges`                                                                                                                              |
| `src/features/library/components/LibraryOptionsPanel.tsx`                                            | progress-badge toggle under Badges                                                                                                                                            |
| `src/features/manga/components/details/MangaDetails.tsx`                                             | series progress line + Similar section                                                                                                                                        |
| `src/features/reader/overlay/navigation/desktop/ReaderNavBarDesktop.tsx`                             | "Ch. 21 / 200" under the chapter picker, then the Comments and Compare buttons                                                                                                |
| `src/features/reader/overlay/navigation/mobile/ReaderBottomBarMobile.tsx`                            | Comments icon button after Settings                                                                                                                                           |
| `src/features/chapter/components/cards/ChapterCard.tsx`                                              | `<TsujiChapterCommentsButton>` after the row's options button (series page only)                                                                                              |
| `src/features/reader/settings/general/ReaderGeneralSettings.tsx`                                     | reader progress toggle                                                                                                                                                        |
| `src/features/reader/settings/layout/ReaderLayoutSettings.tsx`                                       | `<TsujiPagePositionSetting>` after the reader width                                                                                                                           |
| `src/features/reader/overlay/navigation/desktop/quick-settings/ReaderNavBarDesktopQuickSettings.tsx` | `<TsujiPagePositionQuickSetting>` (Left / Center / Right)                                                                                                                     |
| `src/App.tsx`                                                                                        | Discover route (lazy)                                                                                                                                                         |
| `src/base/AppRoute.constants.ts`                                                                     | `discover` route constant                                                                                                                                                     |
| `src/features/navigation-bar/NavigationBar.constants.ts`                                             | Discover nav item (desktop sidebar, More on mobile)                                                                                                                           |
| `src/features/navigation-bar/components/DefaultNavBar.tsx`                                           | `<TsujiChapterBell />` after the app bar's `{action}` (brief #10)                                                                                                             |
| `src/features/app-updates/components/WebUIUpdateChecker.tsx`                                         | wrapper: mount only after server settings load, never for Custom (brief #2)                                                                                                   |
| `src/features/reader/viewer/ReaderChapterViewer.tsx`                                                 | `useTsujiReaderResume(...)` call (resume pin + in-page offset save); `getPagePositionSx(...)` in the viewer's sx (page position)                                              |
| `src/features/reader/services/ReaderControls.ts`                                                     | `shouldSkipTsujiProgressWrite` guard before the lastPageRead write                                                                                                            |
| `src/features/reader/viewer/ReaderViewer.tsx`                                                        | route resume mode via `useTsujiRouteResumeMode` (no state: last read); `useTsujiPagePositionHotkey()` (Shift+L); `<TsujiReaderRawLayer>` (Compare pane, end-of-release offer) |
| `src/features/reader/services/ReaderService.ts`                                                      | progress update targets via `getTsujiReaderUpdateChapters` (copies); download ahead via `getTsujiChapterIdsForDownloadAhead` (no on-disk rule)                                |
| `src/features/reader/hooks/useReaderSetChaptersState.ts`                                             | reader chapter list via `tsujiRemoveDuplicates`                                                                                                                               |
| `src/features/reader/Reader.utils.ts`                                                                | delete-while-reading copies via `tsujiAddDuplicates`                                                                                                                          |
| `src/features/chapter/services/Chapters.ts`                                                          | `markAsRead` ids via `withTsujiReadCopies` (manual marks reach copies)                                                                                                        |
| `src/features/chapter/components/ChapterList.tsx`                                                    | Resume FAB chapter via `getTsujiResumeChapter`                                                                                                                                |

Also changed: `package.json` (vitest + playwright-core devDependencies, `test:tsuji`, `test:tsuji:e2e`,
`codegen:offline`), `pnpm-lock.yaml`. Added at the
root: `gql_codegen.offline.ts`. Added: `docs/tsuji/**`, `.github/workflows/tsuji-release.yml`.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm lint && pnpm format:check && pnpm tsc
pnpm test:tsuji            # vitest, src/features/tsuji/**/*.test.ts
pnpm test:tsuji:e2e        # after pnpm build: mocked Suwayomi (+ fixture AniList): reader resume, For You, duplicates, Similar row, comments (fake relay), page position, raws / Compare (fake feed), universal tags + preview tabs (fake MU / Comick) (E2E_BROWSERS=chrome,firefox adds Firefox)
pnpm build                 # output in build/
pnpm codegen:offline       # types from docs/tsuji/schema.graphql, no server needed
pnpm i18n:extract          # en.po only
```

Offline codegen was byte-identical to live codegen against v2.3.2243 (run `oxfmt --write` on the three generated
files afterwards, as the commit hook would). Refresh `docs/tsuji/schema.graphql` from the server's introspection when
the server is upgraded (and keep custom-scalar descriptions out of it, or the generated comments drift). The snapshot
is v2.4.2366's (dumped from the LAN by Cowork, `420a79ea`; cloud sessions can't reach the server); its codegen only
added types (platform / JVM info, cookie clearing, download reorder, deprecations), no fork code changed.

## CI and releases

`.github/workflows/tsuji-release.yml` runs on every push to `custom` and `feat/**`: install, lint, tsc, `test:tsuji`,
build, `test:tsuji:e2e`, zip `build/` like `pnpm build-zip` (with a `revision` file), then publishes a GitHub release tagged
`r<commit count>-<short sha>` with the zip and a `.sha256` file. `feat/**` builds are prereleases. If the tag already
exists (a checked feat prerelease fast-forwarded to `custom`), the run skips build and zip and, on `custom`, only
promotes that prerelease to a full release, so the deployed zip and its sha256 stay the ones that were checked.

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
