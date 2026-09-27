# Tsuji fork: plan and execution log

Working plan for the current feature and the report of its last run. State, rules and the upstream touch list are in
[HANDOFF.md](HANDOFF.md). Brief #1 (series progress, Similar, Discover) is summarised at the end; its commit is
`d78289ca` on `custom`.

## Acceptance for brief #2 (owner on the server, Firefox)

1. Discover with "Hide what's on my AniList" on: nothing on the AniList list as Reading, Completed, Dropped or Paused
   appears (spot-check Reborn Rich; Solo Leveling itself is not on the list, only "Ragnarok" as Planned).
2. Filter off: those titles return with the right badge ("Completed", "Reading 45/120", ...).
3. Mark as read on a card: it disappears, on other devices too; Undo brings it back.
4. With AniList degraded, Discover shows cards in under 6 s; tabs, tag picker and filters work before that.
5. Library load: no `checkForWebUIUpdate` error in the server log and no ~10 s stall.
6. Tests cover list parsing, hide rules, merge-on-write for `tsuji_seen`, timeout + parallel landing, sort memory.

# Fix: webtoon resume lands short (branch `feat/reader-resume`)

Upstream bug, reproduced on the server: in continuous vertical / webtoon mode a reload resumes near the top
(lastPageRead = 5 at ~7000 px, after reload scrollTop = 957). Upstream scrolls to the page once while the pages above
have no height yet (images not loaded), so it lands short, and the next scroll saves a lower page.

- **Pin** (`src/features/tsuji/reader/resumePin.ts`): on the initial chapter, resume mode "last read",
  lastPageRead > 0, the target page (+ saved in-page offset) is re-anchored to the top on every size change of the
  chapter boxes or the target page (ResizeObserver; MutationObserver adds chapters inserted later). It lets go on the
  first wheel, touchstart, pointerdown or keydown, or after 8 s (checked on each event, no timers).
- **No downgrade** (`resumeState.ts`): upstream's lastPageRead write is skipped while pinned, and below the restored
  page until the user has moved (a write debounced during the restore can't land a lower page afterwards).
- **In-page offset** (`pageOffsets.ts`): 0-1 offset inside the current page, per chapter, in localStorage
  `tsuji_readerPageOffsets` (200 most recent chapters), saved on scroll (one per frame) when not restoring, applied only
  when saved on the same page as lastPageRead. Per browser: another device resumes at the page start.
- Upstream hooks: `ReaderChapterViewer.tsx` (hook call), `ReaderControls.ts` (write guard), `ReaderViewer.tsx`
  (route resume mode).

**r3385 failed live** (2026-09-26, owner: /manga/450/chapter/1, chapter 52950, lastPageRead 4, offset 0.1316):
a hard reload stayed at the top of page 0 (scrollTop 957, below the 957 px chapter-transition block). Cause: a direct
URL load or F5 has no route state, upstream then uses resume mode START, so the pin (which requires "last read")
never ran. The write guard held (lastPageRead stayed 4). The earlier Chromium check mounted the pin directly and
missed the route entry.

- **Route resume mode** (`routeResumeMode.ts`, r3386): without route state, an unread chapter with lastPageRead > 0
  resumes at lastPageRead (like opening it from the chapter list); read or untouched chapters still start at the top;
  explicit state from in-app navigation wins. Decided once per initial chapter. Applies to every reading mode (paged
  modes resume on the page; the pin is webtoon / continuous vertical only).
- **Browser test through the real route entry** (`tools/scripts/tsuji/reader-resume.e2e.mjs`, `pnpm test:tsuji:e2e`,
  also in CI): production build in Chrome against an in-memory Suwayomi (`mockSuwayomi.mjs`, real GraphQL documents
  executed on `docs/tsuji/schema.graphql`), slow page images, fresh `goto` of `/manga/450/chapter/1` then `reload()`.
  On the r3385 bundle (`index-DKTl1wQu.js`) it fails like the server (stuck at the page-0 top); on r3386 it lands on
  page 4 + 0.1316 at 3 s and 10 s, writes no lastPageRead below 4, and a wheel scroll releases the pin.
- Tests (`resumePin.test.ts`): bug repro without the pin, restore with lazy images of unknown height in any load order,
  offset, 8 s deadline, each user intent cancels, no lower lastPageRead during and after restore, offset storage.
  Also checked in headless Chromium with a real ResizeObserver: lands at exactly 7400 px (page 5 + 0.25), no writes
  while pinned, wheel releases it.

**r3386 shipped (2026-09-26); the in-page offset was ignored live**: chapter 52950, saved [4, 0.1316], F5 landed on
the exact top of page 4 (4785 px; pages 0-3 above stay unloaded 957 px placeholders; page 4 is 1213 px), stable at
2/5/10 s. The offset needs the target's real height, which only exists once its image is loaded (a loading page's
image is 0 px and hidden); if the pin ended first (8 s limit, or a click that doesn't scroll), nothing applied it.

- **Fix (r3387, branch `feat/reader-resume-offset`)**: the pin holds the page top until the target image is loaded,
  then applies the offset from its real height, independent of the pages above. If the pin already ended, the
  offset is still applied once when the target loads, as long as the reader still sits at that page top (a real
  user scroll wins). While pinned, a programmatic scroll (upstream scrolling to the page top again) re-anchors.
  The in-page offset is not saved while it is still to be applied.
- **e2e scenarios** (`pnpm test:tsuji:e2e`, 5 scenarios, 40 checks, each requires the target's real height): slow
  images; instant images with unloaded placeholders above (the owner's geometry: page 4 top at 4785); auto webtoon
  (manhwa, reading mode known late); target image after the 8 s limit; a non-scrolling click before the target
  loads. The last two fail on r3386 with exactly the live result (scrollTop 4785 = page top) and pass on r3387.

**r3387 failed live** (2026-09-26, Cowork in Chrome, the owner in Firefox; manga 450, chapter 52952, 60 pages): a
real wheel scroll to 4957 saved [3, 0.2875] and lastPageRead 3; F5 left the reader at scrollTop 957 (page 0 top) and
the offset was then overwritten with [0, 0]. Reproduced with the r3387 build against the live server (all writes
blocked): a fresh load or a reload without route state resumes correctly; a reload of a tab whose history entry
holds `resumeMode: START` fails exactly like the report. Cause: an in-app open puts the resume mode in the history
entry's route state (START for the reader's own chapter navigation, which also replaces the URL), and the browser
keeps history.state across F5. Upstream then scrolls to page 0, the pin (LAST_READ only) never starts, and the saver
saves upstream's own scroll as [0, 0].

- **Reload while reading** (`routeResumeMode.ts`): once the user reads, the saver writes a per-tab marker
  (sessionStorage `tsuji_readerReading`: chapter id + a random id of the page load; not a time, since Date.now()
  and performance.timeOrigin drift apart across system sleep). A page load that started on the reader URL now open,
  with a marker for the same chapter from an earlier page load, resumes at lastPageRead whatever the route state
  says. The override is used once (the chapter is then marked for this page load, so a second F5 works too), and a
  later in-app open in the same page load follows its route state as before.
- **No saves before the user moves** (`useTsujiReaderResume.ts`): the offset is only saved after a wheel, touch,
  pointer or key event since the initial chapter opened (tracked from the ReaderViewer hook, reset when an in-app
  open changes the initial chapter); the reader's own scrolls (initial scroll, restore, layout shifts) never
  overwrite the saved spot.
- **Pin after upstream's scroll** (`useTsujiReaderResume.ts`): starts once upstream's `pageToScrollToIndex` has been
  consumed, then re-anchors on ResizeObserver, image load (capture), scroll and child-list changes. It ends on user
  input, after 500 ms without layout change once the target image has loaded, or at 10 s (a timer now, was a lazy
  8 s check). Anchor = target top in scroll coordinates + offset x target height (measured with bounding rects
  relative to the scroll element, the same quantity as offsetTop + frac x offsetHeight when the scroller is the
  offset parent). No saved offset: the lastPageRead page top. A saved offset on page 0 is restored too.
- **e2e** (`reader-resume.e2e.mjs`, now 9 scenarios / 62 checks): four new scenarios shaped like the live repro
  (chapter 3 of 5, 60 pages of two heights, 957 px viewport, reader width 43 %, stretched pages): real wheel scroll
  into page 3, then F5 with route state START / LAST_READ / none, and with no saved offset. Each checks scrollTop
  within 50 px of the saved spot 1 s and 4 s after F5 and after a second F5, the offset kept, no lower lastPageRead,
  and saves resuming after the next wheel. On r3387 the START and no-offset scenarios fail exactly like live (957,
  [0, 0]); all pass with the fix. Also checked against the live server (writes blocked, server state unchanged):
  START state, wheel to 4250, F5 -> 4250, offset kept.
- Review (independent agent): fixed the two-clock comparison (now a page-load id), the override applying again to a
  later in-app open, and the input flag surviving an in-app chapter switch. Not changed: "settled can let go before
  pages above load" - upstream never loads pages above the current one in continuous modes
  (`ReaderPager.utils.tsx`, `getPageIndexesToLoad`), so nothing above the target loads until the user scrolls up.
- Not covered: paged reading modes still follow the route state on F5 (the marker is written by the vertical saver).

**r3388 live: page-level resume held, but the offset was never saved** (Cowork in Chrome, the owner in Firefox):
`tsuji_readerPageOffsets` c52952 stayed at the stale [0, 0] through real wheel scrolls, so F5 landed on the page top,
135 px short. With a clean profile the same bundle saves on wheel in Chrome and Firefox, against the live server too
(writes blocked). r3388 had two ways to never save that its tests didn't cover: the saver only ran after a wheel /
touchstart / pointerdown / keydown event (a scroll without one - scrollbar drag, assistive tech, a script - never
opened it; the new e2e step fails on r3388 in both browsers), and a refused localStorage write was swallowed without
a trace. A full localStorage is unlikely (in a test it stopped the reader from rendering at all).

- **Saver** (`useTsujiReaderResume.ts`, `pageOffsets.ts`): no longer depends on input events. Nothing is saved while
  the restore runs; before the user's first input only a viewport top sitting on a page top (within 2 px: upstream's
  scroll to a page, a restore without offset) is skipped as the reader's own; any other position is saved. rAF only
  paces saves (it doesn't run in hidden tabs; both reports were visible tabs).
- **Readout** `window.tsujiReaderResume` (console): scroll events seen, saves, refused writes with the error, skips by
  reason (restoring / noPage / readerPosition), the user-input flag and the restore state. Scroll events without
  attempts would mean no animation frames ran.
- **F5 within 1 s of a page change**: upstream writes lastPageRead 1 s after the page changes, so the saved spot could
  be on a page the server doesn't know yet and was ignored (previous page's top). On a reload while reading, this
  tab's saved spot now wins when it is on or past lastPageRead (never lower).
- **e2e**: new "saves follow every kind of scroll" scenario (old spot kept through the reader's own first scroll; script
  scroll without input events, wheel, arrow key; readout; F5 0.3 s after crossing into the next page; F5 after
  lastPageRead lands). Runs in Chrome and Firefox (`E2E_BROWSERS=chrome,firefox`, CI installs Playwright's Firefox),
  with the START wheel-then-F5 scenario in Firefox too: 85 checks. Live server (writes blocked, stale [0, 0] seeded):
  landing keeps [0, 0], wheel to 5300 saves [4, 0.7022], F5 -> 5300.

## Acceptance (owner, on the server)

1. Webtoon chapter, read to the middle of page 5+, reload: lands on the same spot, not the top.
2. Scroll right after reload: the reader doesn't pull back.
3. Server lastPageRead after the reload is not lower than before it.
4. Same after opening the chapter from inside the reader (chapter picker / next chapter), reading, then F5.

# Brief #2.1: "Hide what I've started" + sharded marks

Same branch, on top of brief #2. Both changes stay inside `src/features/tsuji/**`; no new upstream hook.

1. **"Hide titles in my library" becomes "Hide what I've started".** Only library titles with >= 1 chapter read are
   hidden; unread library titles show. `TSUJI_LIBRARY_INDEX` now fetches `unreadCount` + `chapters.totalCount`
   (`MangaType.chapters` takes no condition on v2.3.2243), read = total - unread, indexed only when > 0. The persisted
   filter key stays `hideInLibrary`, so saved filters keep working.
2. **`tsuji_seen` sharded.** The server rejected a 9247-char value (~350 marks) against its 4096-char global meta
   limit. Marks now live in `tsuji_seen_0` .. `tsuji_seen_15`, bucket = mediaId % 16, value `{"r":[ids],"s":[ids]}`
   (ids ascending). All buckets are read in one global meta request; a write touches only the changed buckets
   (read-merge-write, serialized per tab), deletes a bucket that becomes empty, and skips no-op writes. A write that
   would push any bucket past 3800 chars is refused before anything is sent, with an error toast. Capacity: ~540
   six-digit ids per bucket, ~8,600 marks total when evenly spread.
3. **Migration:** the first screen that reads marks (Discover, Similar, settings) moves a legacy `tsuji_seen` value into
   the shards in one request and deletes the legacy key. It also handles upstream's chunked layout
   (`tsuji_seen_length` + `tsuji_seen_<i>`), whose chunk keys collide with the shard names. Shard writes bypass
   upstream's metadata updater for that reason.

## Acceptance for brief #2.1 (owner on the server)

1. Discover / Similar with "Hide what I've started" on: a library title with 0 chapters read shows; one with >= 1 read
   is hidden. Off: both show.
2. Existing marks survive the update (legacy `tsuji_seen` gone from global meta, `tsuji_seen_<n>` keys present).
3. Mark as read / Undo / Clear all still work, and the downstairs PC sees the same marks.

Tests: started vs unread-in-library (id, MAL id, title, 0-chapter titles), 5,000 marks round-trip under the server
limit, single-mark write touches one bucket, legacy + chunked legacy migration, 3800-char guard (write and migration).

# Brief #2: "already read" filter + speed fixes

Branch `feat/anilist-seen-speed` off `custom` (`d78289ca`, r3380). Same rules as brief #1. **Stop before commit.**

## Measured first (2026-09-25, from the owner's LAN)

AniList right now: Trending 2.4 s, Popular (full card fields + format_not_in/isAdult) 1.6 s, Popular without those two
filters 0.37 s, minimal fields 0.16 s, `MediaListCollection(ejustice)` 0.21 s (6 lists). Cowork's ~10 s/call was a
degraded window; latency swings, so the fixes must work at both 0.3 s and 10 s.

## Decisions

1. **Queue:** token bucket, burst 3, refill 1 per 2.1 s (avg <= ~29/min). Trending + Popular + list fire together.
2. **Timeouts** (`timeoutMs` per AniList request): 4 s for the first attempt of a chain and for optional steps
   (hydrate, Jikan, list); 12 s for the last attempt (Similar seed, final Discover fallback, tag catalog), so a
   uniformly slow AniList still renders instead of timing everything out.
3. **format_not_in / isAdult never sent to AniList** (client filters already enforce them; they are the flaky
   arguments and cost ~1.2 s/call). status/country/minScore stay server-side with the relaxed retry.
4. **Degradation memory** in sessionStorage, 30 min: failed sorts (empty or timeout) and "relax filters".
5. **Landing:** Trending + Popular in parallel; grid shows Trending if non-empty, else Popular as soon as it lands;
   swaps to Trending later only if the user hasn't scrolled (< 120 px) and hasn't paged Popular. Popular row shows
   only when the grid is Trending.
6. **Never block:** tab strip, tag picker button, filters render immediately. Tag catalog loads on first expand.
   Cards show skeletons until the library index and the AniList list are in (list capped by its 4 s timeout; on
   failure: show everything + quiet notice + retry).
7. **Tsuji settings panel** = dialog from a gear on Discover: AniList username (`tsuji_anilistUser`, default
   `ejustice`), last list sync + refresh, marks count + "Clear all marks" (confirm). No extra upstream hook.
8. **Hide rule** (`hideOnMyList` default ON, `hidePlanned` default OFF): hide CURRENT, COMPLETED, DROPPED, PAUSED,
   REPEATING, manual `read` and `skip`; PLANNING hidden only with `hidePlanned`. Filter badge counts it like the other
   default-ON filters (when changed from default).
9. **Badges** (cover bottom-right): Completed (statusComplete), Reading N/M or Reading N (statusOngoing),
   Rereading (statusOngoing), Dropped / Paused (`statusPaused`, gray alias added to the palette), Planned (info),
   manual Read (statusComplete) / Not interested (statusPaused). Manual mark wins over the AniList status.
10. **Marks:** `tsuji_seen` global meta JSON `{ [anilistId]: "read" | "skip" }`. Merge on write: fetch fresh global
    meta (network-only), patch, write once. Undo in the toast re-applies the previous value. Card overflow menu +
    preview dialog: Mark as read / Not interested / Unhide.
11. **Update check:** `WebUIUpdateChecker.tsx` gates `shouldCheckForUpdate` on server settings loaded and
    `webUIFlavor !== Custom` (upstream file #12). About page's manual check untouched.
12. Later option (not built): AniList writes need OAuth in the browser.

## Tasks

1. Queue token bucket + AniList `timeoutMs` (tests: burst/refill, timeout rejects).
2. `degradedMemory.ts` (sessionStorage TTL, tests); DiscoverService uses it, drops format/isAdult, timeouts.
3. Landing selection pure fn (tests) + Discover wiring; lazy tag catalog; skeleton-first.
4. `myList.ts` parse (tests) + `useMyAniList` shared store + TsujiCache 30 min.
5. `seen.ts`: statuses, hide rules, badge mapping, `applySeenPatch` (tests); `SeenService` merge-on-write (tests).
6. RecFilters fields + filter bar toggles; passesFilters wiring for Discover + Similar.
7. Card badge + overflow menu + preview actions + Undo toast; settings dialog.
8. Update-check hook. 9. Gates, build, live check, review, HANDOFF, stop before commit.

---

## Execution report (2026-09-25) - STOPPED BEFORE COMMIT (awaiting Ethan's server check)

### State

- Branch `feat/anilist-seen-speed` (off `custom` = `d78289ca`), **uncommitted**. Commit SHA on `custom`: pending your OK.
- Build: `build/` (651 files, `revision` = `r3381`, the revision this becomes once committed).
- Zip: `buildZip/Suwayomi-WebUI-r3381.zip` (local build), 3,008,758 B,
  sha256 `89db14e625aa68b541d9e17590cdd7a28d5d2a798ab7fe0808c7c81a956a7c87`.
- Tests: 12 files / 147 tests pass. lint, format:check, tsc clean. i18n extracted.
- Bundle vs r3380: main entry 1,221,243 -> 1,221,406 B (+163 B); `build/` 8,223,026 -> 8,360,104 B (+137 KB);
  lazy chunks Discover 16.9 -> 22.5 KB, SimilarSection 7.5 -> 8.0 KB.

### Upstream files touched (this brief)

- `src/features/app-updates/components/WebUIUpdateChecker.tsx` (+17/-2): the existing component is renamed
  `WebUIUpdateCheckerContent` (body unchanged); a new exported `WebUIUpdateChecker` wrapper renders it only once
  server settings are loaded and the flavor isn't Custom. Tool-written: `src/i18n/locales/en.po`.
- Total upstream footprint on `custom` after this: 12 source files.

### Measured (production build via vite preview -> your server, AniList degraded: Trending 10.3 s + empty)

- Shell, tabs, tag picker: 0.36 s. First card: ~1.0-1.2 s (was ~21 s). Your list: 0.24-0.7 s, cached 30 min.
- No `CHECK_FOR_WEBUI_UPDATE` request on load (flavor CUSTOM).
- Dev mode StrictMode exposed an abort bug (request aborted between queue and fetch still went out and burned a
  token); fixed with a refund + pre-send check, regression-tested.

### Acceptance walk-through (done live against the server, test marks cleaned up: `tsuji_seen` = `{}`)

1. Filter ON: 0 of 28 rendered cards were on `ejustice` as Reading/Completed/Dropped/Paused/Rereading.
   **Solo Leveling (105398) is NOT on your AniList list** (only "Ragnarok" 179445, Planning, which is also in your
   library), so it shows until you "Mark as read" it. Reborn Rich = Paused 121 -> hidden.
2. Filter OFF: badges shown, e.g. "Reading 330" (Nano Machine), "Reading 86", "Reading 225"; totals appear only
   when AniList knows a chapter count (ongoing series have none).
3. Mark as read -> card gone, server `tsuji_seen` = `{"201009":"read"}` (what the downstairs PC reads); Undo ->
   back. Merge-on-write kept the other device's mark in the same run. Undo toast lasts 8 s.
4. See "Measured". 5. No update check from the client; the server log check is Cowork's.
5. Tests: list parsing, hide rules (each status, Planned toggle, marks), merge-on-write + serialized updates + undo
   guard, timeout + parallel landing (pickLandingSource), sort/relax memory (DegradedMemory), queue burst/refund.

### Decisions / deviations

- **Your saved filters include Type = Manhwa + Manhua.** AniList can only filter one country server-side, so two
  types are filtered client-side; AniList's all-time Popular list is mostly JP manga, so few survive per page.
  Mitigated with 50-item pages (AniList max). Picking Manhwa only (server-side KR) or tags gives full grids.
- `format_not_in` / `isAdult` are no longer sent to AniList (client filters apply): 1.6 s -> 0.37 s per call and they
  were the arguments degraded mode dropped.
- Queue is a token bucket (burst 3, 1 per 2.1 s) so Trending, Popular and your list fire together.
- Failed sorts / relaxed filters are remembered only with evidence (fallback worked, or relaxed titles still match the
  dropped filters), so a genuinely empty filter combination doesn't flip Discover into relaxed mode.
- Filter badge counts "Hide what's on my AniList" / "Also hide Planned" when changed from default, like the other
  default-ON filters.
- Tsuji settings panel = gear on Discover (username, list sync + refresh, marks count, Clear all). Clearing the
  username field returns to `ejustice`. Note: the default `ejustice` is baked into this build.
- Cards stacked badge: list/mark badge sits above the release status (bottom-left) so 140 px cards don't collide.

### Independent review (all fixed)

Refresh no longer blanks the grid (only the first list load blocks cards; failures back off 5 min); Undo can't
overwrite a newer mark; degradation memory needs evidence; update-checker wrapper instead of gating the timer (the
earlier gate could delay stock-flavor checks by an hour); memoized seen states so cards don't all re-render; caller
abort during body read is rethrown; Jikan deadline now aborts its fetch; fresh meta read skips Apollo dedup.

### Cowork deploy

`Homelab_SuwayomiWebUI_Deploy_v1.sh` with `build\` (or the zip); move the current r3380 folder to `webUI.r3380`
(stock copy already in `webUI.stock-r3379`). After your OK: commit on the feature branch, fast-forward `custom`,
push.

---

# Brief #1 (shipped as `d78289ca`, r3380)

- **Series progress:** "21/200" library badge (grid + list) from `latestReadChapter` / `highestNumberedChapter`
  (falls back to the chapter count), "Ch 21 / 200 · 179 left" on the series page, "Ch. 21 / 200" under the desktop
  reader's chapter picker (denominator from the full chapter list, once per session). Toggles default on.
- **Similar** on the series page: AniList id from the tracker, cached `tsuji_anilistId`, MAL tracker, or an exact
  normalized title search; AniList recommendation edges + tag recall (top 3 non-technical tags, minimumTagRank 60)
    - Jikan (MAL) mapped back via `idMal_in`; ranked with Makimono's shipped RecommendationRanker (edge 0.5 / tag
      cosine 0.3 / Bayesian quality 0.2 with m = 5000, agreement blend 0.45, hidden gems quality \* (1 - pop)^2 with
      popularity >= 50, MMR lambda 0.7 over the top 25); client filters and sorts; 7-day cache capped at ~1 MB.
- **Discover** (`/discover`): AniList tag catalog, tri-state tag/genre picker, infinite scroll, Best match re-rank per
  page, fallbacks for AniList's degraded mode.
- Cards: score top-left, chapters top-right (only when known), status bottom-left; tap = global search prefilled
  across all sources; right-click / long-press = preview (Open on AniList, Find to read).
