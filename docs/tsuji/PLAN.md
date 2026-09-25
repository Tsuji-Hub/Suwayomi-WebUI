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
