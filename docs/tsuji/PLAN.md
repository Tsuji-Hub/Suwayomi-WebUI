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

# Brief #8 v2: universal tag search + comments in the preview (branch `feat/discover-tags-comments`)

Off `custom` (r3409). AniList has no "System" (428 tags, 19 genres); MangaUpdates has it as a category (602 series).
One search box covers both; the user never picks a source. No upstream file touched.

**Done** (r3410):

- Suggestions (`tags/tagKeys.ts`, `useTagSuggestions`): 300 ms after typing, the AniList catalog (cached a week, as
  before) merged with MU `v1/categories/search` (usage >= 20, cached a week per query). Names merge on a normalized
  key (lowercase, MU's "/s" "/es" "/ies" and punctuation dropped, trailing plural s dropped): AniList "Dungeon" + MU
  "Dungeon/s" = one chip. Aliases: system = System + Level System + Stat System; litrpg / game elements = Game
  Elements + Level System; regression = Regression. Chip label "System · 602 titles" (MU's first category; AniList
  gives no counts); the sources are only in the hover text ("includes: ..."). Tri-state as before.
- Selection: AniList-only chips stay in `genres` / `tags` (unchanged path); chips with MU categories go to `mu`
  (with their AniList name when merged, so AniList searches use it too).
- Engine (`getSearchEngine`): AniList unless a selected chip (included or excluded) has no AniList backing; then MU
  `v1/series/search` through the relay: `category` per query, `exclude_category`, `exclude_genre`
  [Adult, Hentai, Smut] unless the Adult filter is on, `type` from the Type filter (comics only without one),
  `orderby` rating (NEWEST: year), 50 per page. Categories inside a chip are OR (one query per combination, at most
  6, merged and de-duplicated by series_id), chips are AND, assuming MU ANDs the `category` array (the website's
  advanced search does; `MU_CATEGORY_ARRAY_IS_AND`, check live: System + Martial Arts must narrow). MU budget 20/min
  client side (own queue), 8 s timeout.
- Matching (`tags/muService.ts`): cached `mu:match:v1:<series_id>` (30 days) -> one `id_in` request; the rest 10
  titles per aliased AniList request (m0..m9, 3 hits each) through the shared AniList queue. Accepted when the
  normalized MU title equals any AniList name (synonyms too), else the top hit at similarity >= 0.9 from the MU
  type's country and within a year. AniList-only chips post-filter matched media (tags rank >= 60, genres as is);
  unmatched cards drop out only when such a chip is included. `isAdult` matches drop unless the Adult filter is on.
  Unmatched series still show (MU title, cover, rating; negative id: no marks or badges; Find to read by title).
- Preview (`RecPreviewDialog`): Overview / Comments / Reviews tabs, each loaded (code and requests) when opened.
  Comments: the Comick series whose `links.al` is the AniList id (search by the AniList titles, top 3 candidates,
  detail fetched when the search has no links; MangaDex `/mangadex/manga` supplies more titles of the manga linked to
  the same id), cached a week (misses a day); "No comments found" otherwise and for unmatched MU cards. Opens on the
  newest chapter Comick has, with the brief #5.1 picker (chapters from Comick's chapter map). Reviews: AniList's 5
  best-rated (summary, score, helpful count, link).
- Unit (22): tag keys, suggestions (System alias, Dungeon merge, adult, noise, aliases), engine, merged chips on
  AniList, MU queries (OR/AND combinations, cap, adult, types, sort), MU parsing, matching, post-filter, unmatched
  cards, Comick-by-AniList (links.al, look-alikes refused, MangaDex fallback, cache). Browser
  (`discover-tags.e2e.mjs`, 16 checks) with a fake MU / Comick relay.

# Brief #6 v2: Raws, Translate, Compare (branch `feat/raw-compare`)

Replaces #6 v1 (no "Find raw": the server links raws itself). Stacked on `feat/reader-position` (Compare drives the
English page position). Server side, already live and not rebuilt here: rawfinder (daily) writes `tsuji_raw_links` on
each English copy; mtl-engine translates on request into "<title> [MTL]" (local source, "Raws" category, not in the
library). The WebUI reads that meta and the relay's feed and opens the feed's pre-signed links; it writes nothing.

**Done** (r3409; r3408 failed one Firefox check that counted the browser's CORS log for blocked AniList calls):

- `raws/rawLinks.ts` (pure): meta parse (raw + mtl ids, tolerant), feed parse (rows by `en_id`, URLs kept as sent),
  ids from server URLs, combined series links. `raws/rawFeed.ts`: `${tsuji_commentsRelay}/mtl/raws.json`, 5 s
  timeout, cached a minute, failures = no feed (the meta chips still show).
- Series page (`RawChips`, mounted by the fork's Similar wrapper, no new upstream hook): "Raw · <source>" and
  "MTL · <done> translated" (in-app links to the series), "18+ raw" when `uncensored`, and while the raw is ahead
  Translate <next> / Next 10 / All <n> (+ Cancel while queued). They open the pre-signed link in a dialog with an
  iframe (sandboxed, no parsing); the server's confirm page for big batches works inside it; the feed is re-fetched
  when the dialog closes.
- Numbering (`raws/rawNumbering.ts`): CN the LAST 第N话, KR the FIRST N화, JP 第N話 / N話 (full-width digits
  too), else chapterNumber, extras never; 🔒 names never map; first by source order on duplicates. The `numbering`
  string in meta is ignored (stale for KR). Origin from the feed row; without one, KR, CN, JP are tried in turn.
- Compare (`TsujiReaderRawLayer`, `TsujiReaderCompareButton`): desktop reader menu button for series with a raw, in
  continuous vertical / webtoon. English moves to the left half (page position LEFT, images capped at 50vw, whatever
  the setting); the raw chapter with the same number fills a fixed right pane, all its pages loaded, scrolled to the
  English chapter's scroll fraction (top-at-top 0 .. bottom-at-bottom 1, measured from the chapter's page elements,
  which `useTsujiReaderResume` registers). The pane takes no input: wheel and clicks drive the English side. Off when
  the reader closes.
- End of the newest English chapter (>= 90 % scrolled): "Read MTL ch N" when the MTL series has N, else "Translate
  ch <next>" (t_next in the dialog) when the raw is ahead. Never automatic.
- Mock Suwayomi serves several manga now (`extraMangas`) and logs mutations (asserting no library writes). The
  comments suite ignores the relay's `/mtl/` requests (the series page loads the feed too).
- Unit (12): meta / feed parse, URL ids, series links, KR / CN / JP numbering, 🔒 and extras, duplicates, fraction
  and pane scroll, end offers. Browser (`raws.e2e.mjs`, 21 checks): chips and actions for Return to Player (EN 12210,
  raw 13858 GoodToon, MTL 14377 as in the brief), in-app links, 18+ badge, "All 108" -> server confirm page in the
  dialog -> Yes (relative link) confirmed, feed re-fetched, Cancel, no library writes on opening the raw, no chips
  without links, Compare on EN 138 -> the raw named "138화 (2부 12화)" (chapterNumber 7), split halves, English at 50 %
  -> raw at 50 % (4 English strips vs 12 raw pages), "Read MTL ch 139" opens it, CN last 第N话, "Translate ch 46",
  no page or app console errors.

# Brief #7: reader page position (branch `feat/reader-position`)

Off `custom` (r3401). The owner reads on a projector lying on his side: pages at the left edge of a maximized window,
same size as centered, black on the right. Page widths are in vw, so shrinking the window shrank the pages; this
replaces his bookmarklet (translateX on the viewer's children).

**Done** (r3407; r3404-r3406 failed only the test's Firefox menu step: headless Firefox has no fine pointer, so the
reader showed its mobile overlay; Firefox now runs with mouse pointer prefs):

- Settings `pagePosition` (LEFT / CENTER / RIGHT, default CENTER) and `pageEdgeOffset` (0-800 px, default 0), per
  device preset like the reader width, stored as raw global meta `tsuji_pagePosition` / `tsuji_<device>_pagePosition`
  (and `..._pageEdgeOffset`): upstream's reader-setting keys would need `Metadata.constants.ts`, `Reader.types.ts`,
  the defaults and `ReaderSettingsMetadata.ts` changed, and its migrations delete unregistered `webUI_*` keys. Not
  per manga or per reading mode (the brief asked for per device).
- Layout (`reader/position/pagePosition.ts`): upstream centers each chapter viewer with `margin: auto` (in every mode);
  LEFT becomes `marginLeft: offset, marginRight: auto`, RIGHT the mirror. The images inside get the same edge margin,
  because upstream centers them in the column (`m: auto`) and a not yet loaded page keeps a 40vw placeholder that can
  be wider than a loaded image. Untouched: CENTER, continuous horizontal, hidden chapter viewers (`margin: unset`),
  the images of double page (the spread stays joined; the spread as a whole moves). No size changes, so tap zones,
  scroll preservation, resume and infinite scroll keep working as they are.
- UI: Reader settings > Layout: "Page position" select + "Gap from the edge" slider (hidden for Center). Desktop
  reader menu: Left / Center / Right toggle above Auto scroll. Shift+L cycles the three (reader hotkey scope; the
  owner's bookmarklet key, unused by the reader).
- Unit (5): parse / clamp, cycle, device keys, margins, hidden / horizontal / double page. Browser
  (`reader-position.e2e.mjs`, 1920x1080): CENTER centered; LEFT offset 0 -> image left = 0 and same width as CENTER;
  F5 keeps it; offset 120 -> left = 120; center tap zone opens the menu, its Right writes `tsuji_pagePosition`;
  RIGHT -> 120 px from the scroll area's right edge; Shift+L RIGHT -> LEFT; device GamingPC reads its own key; single
  page LEFT + the right tap zone (empty area) still turns the page; webtoon with the owner's 43 % width; double page
  LEFT joined; infinite scroll: every loaded page of two chapters at the edge; LEFT resume on lastPageRead and F5.

# Brief #5.1: chapter navigation in Comments, per-chapter comment buttons (branch `feat/comments-chapter-nav`)

Off `feat/comments-similar-scroll` (r3392 and r3395 not on `custom` yet). Makimono reference: CommentsScreen.kt
(chapter selector header), MangaScreen.kt (`onChapterCommentsClicked`).

**Shipped** 2026-10-20 as r3401 (with #5 and r3392; desktop checks OK, phone pass waived). **Done** (r3397):

- `comments/chapterNav.ts` (pure): one entry per chapter number >= 0, ascending (numberless -1 chapters have no
  thread to look up and are left out); twins labelled from the reference scanlator's copy (the reader: the copy being
  read; the series page: `tsuji_readScanlator`, else the last read copy by `lastReadAt`; a row: that row's copy), else the first by source order.
  After the r3392 merge the series page prefers r3392's `tsuji_readScanlator` (manga meta) over the last read copy.
  Label "Ch. 75 - Title" (the number the name repeats is dropped). Steps go to the next / previous number in the list,
  also from a number the list lacks; the picker opens on the current entry, else the last one below it.
- Panel header: `< label >` under "Comments". Arrows 40 px, disabled at the ends. The label opens `ChapterPicker`
  (Dialog >= 900 px, bottom sheet below; react-virtuoso, which the app already uses: react-window is not a
  dependency), centered on the current chapter. ArrowLeft / ArrowRight step while focus is in the panel (not in the
  search field); every key but Escape stays in the panel, so the reader's hotkeys don't turn pages behind it. The
  selection is panel state: every open starts on the entry chapter. A number without a Comick entry shows "Comick
  has no thread for chapter N"; only the selected chapter's thread is fetched.
- Series page: one panel (`SeriesCommentsHost` in the Similar section) driven by `commentsPanelStore` (zustand); the
  pill opens chapter 1, each chapter row's icon (`TsujiChapterCommentsButton`, hook in `ChapterCard`) opens its
  chapter. The selector lists the page's chapters from the Apollo cache (`GET_CHAPTERS_MANGA`). The row icon is hidden
  while selecting, in the reader's chapter list, for -1 chapters and while `tsuji_comments` is off; its presses don't
  reach the row's link.
- Reader: the selector lists `mangaChapters`; opens on the current chapter.
- Unit (9): label, twins + reference, steps at both ends and from a missing number, picker index, label fallback,
  last-read scanlator. Browser (`comments.e2e.mjs`, now 50 checks): selector at chapter 1, next to 2 (twins one
  entry), 2.5 "no thread" with arrows working, ArrowRight / ArrowLeft, picker on the current chapter, pick 100,
  picker reopens scrolled to 100, Escape closes only the picker, only selected threads fetched, reopen resets, row
  icon on chapter 150 opens it, tapping the row still opens the reader, row height unchanged and icon hidden with
  comments off, reader next to 2.5 then reopen back on 2, phone: 40 px arrows, picker bottom sheet, row icon fits.

# Brief #5: Comments (Comick) + Similar row scrolling (branch `feat/comments-similar-scroll`)

Off `custom` (r3391); r3392 (duplicate chapters) is merged in once it ships. Same branch, first commits:

- **Download ahead without the "already downloaded" rule** (`tsuji/reader/downloadAhead*.ts`, hook in
  `ReaderService.downloadAhead`): upstream (the Mihon rule) only queued ahead when the current and the next chapter
  were already downloaded, so delete-while-reading plus one failed download stopped the chain. Now the next N
  unread chapters are queued once past 25 % of the current one. The PVE cron `suwayomi-ahead` keeps its retry role.
- **CI** pinned to `ubuntu-24.04` (ubuntu-latest becomes Ubuntu 26 on 2026-10-19).

## Plan

Order: B (small, own prerelease) then A.

**B. Similar row** (`tsuji/similar/`, no upstream hook):

1. `scrollRow.ts` (pure): `getWheelScroll(deltaX, deltaY, scrollLeft, maxScrollLeft)` -> pixels to scroll the row
   or null (horizontal-dominant, or the row is at its end in that direction: the page scrolls). `ScrollRow`
   component: non-passive wheel listener (mouse only, touch pans natively), edge arrows (hover/focus, always on
   coarse pointers, hidden at each end, scroll by `clientWidth - REC_CARD_WIDTH`), focusable with ArrowLeft/Right.
2. Used by Similar, For You's seed rows and Discover's Popular row.
3. "Show all" / "Show as row" in the Similar header, global meta `tsuji_similarLayout` ("row" | "grid"); unset =
   grid on `(pointer: coarse)`, row otherwise. Grid: `repeat(auto-fill, 140px)`, first 24 (at most 4 rows on a
   phone) + More.

**B, done** (r3393): `recs/scrollRow.ts` + `recs/components/ScrollRow.tsx` (Similar, For You seed rows, Discover's
Popular row) and `recs/components/CardGrid.tsx`. Snap scrolling only on coarse pointers (with a wheel it pulled
small steps back to the same card). Unit (9): wheel decision incl. end passthrough and Firefox line units, edges,
page step, layout default, grid cap. Browser (`similar-scroll.e2e.mjs`, 12 checks): wheel moves the row and not the
page, arrows per edge, at the end the wheel is not cancelled (no trap) while wheel-up still moves the row, ArrowLeft
pages back, Show all -> grid stored in global meta and kept after reload, a touch screen gets the capped grid with
More. (The mock manga screen is shorter than the window, so "the page scrolls" is checked as "the wheel event is
not cancelled".)

**A. Comments** (`tsuji/comments/`):

1. `CommentSource` interface (resolveSeries, thread, comments, replies) so Webtoon / MangaDex can be added later;
   `ComickCommentSource` via the relay (`${tsuji_commentsRelay}/comick`, default `http://192.168.5.85:4568`, from
   global meta at runtime). One request at a time through a `RequestQueue` (20/min), 5 s timeout, TsujiCache:
   search match 7 days, chapter map 24 h, comments 2 min.
2. Matching: search by title, best normalized-title similarity >= 0.7 (`recs/normalize.ts`); manual override in
   global meta `tsuji_commentsMatch` (`{ [mangaId]: "hid|id" }`, merge on write like `tsuji_seen`).
3. Chapter map: `/comic/{hid}/chapters?lang=en&limit=100000`, grouped by `chap` (string key, "200.5" kept), most
   viewed (`up_count`) scanlation per number. Thread = chapter 1 on the series view, the current chapter's number
   in the reader; never later chapters.
4. UI: Comments pill in the Similar header (manga screen) and a Comments button in the reader (desktop nav bar,
   mobile bottom bar: 2 one-line hooks); one panel (drawer >= 900 px, bottom sheet below). Comment = author,
   relative time, plain-text body (spoiler chip, quote block, links as text, never HTML), up count, "N replies".
   States: loading, no match + search field, relay unreachable (one line + Retry), empty thread.
5. Settings (Tsuji settings dialog): `tsuji_comments` master toggle, Comick toggle, relay URL, Clear comment cache.
6. Tests: chapter-map reduction, series-key parsing, comment tokenizer, merge-on-write for `tsuji_commentsMatch`,
   timeout; browser e2e with a fake relay.

**A, done** (r3395): `comments/` = `CommentSource.ts` (interface + relay error), `comick.ts` (pure: series key,
Dice title similarity >= 0.7 over title and alternative titles, chapter map, comment mapping), `commentText.ts`
(pure tokenizer), `commentsMatch.ts` (merge-on-write, refuses past 3800 chars), `comickSource.ts` (relay client:
token bucket of 3 then one per 3 s (~20/min), 5 s timeout, 404 = none; source with the three caches),
`commentsService.ts` (relay URL from meta, default `<this host>:4568`; threads cached in memory only, matches and
chapter maps in TsujiCache; Clear comment cache), `useComments.ts`, `components/` (panel, comment, pill + reader
button, settings section in the Tsuji settings dialog). A miss is cached too (7 days) so unmatched series don't
search again; "Wrong series?" or the no-match search writes the override, "Use automatic match" removes it.
Comment bodies are React text only (HTML stays literal, links become their label). Reader: desktop nav bar under
"Ch. x / y", mobile bottom bar after Settings. Unit (19): chapter map incl. "200.5" and ties, `findChapterKey`
(exact, "012", "7.0", -1), series keys, similarity + threshold, tokenizer (spoiler, links, images, quotes, HTML as
text), comment mapping, match parse / merge across devices / size guard, relay timeout (one request), refused,
5xx, 404, caller abort, source caching incl. cached misses. Browser (`comments.e2e.mjs`, 30 checks): drawer 420 px,
most up-voted scanlation's thread, spoiler chip, quote block, no HTML elements, replies collapsed, 50 + Show more,
3 relay requests then all from cache on reopen, reader shows the current chapter without refetching match or map,
master switch hides the pill, no match -> search -> pick merged into `tsuji_commentsMatch` and kept after reload,
relay refused and hanging (gives up at ~5.4 s) each after one request, Retry recovers, phone bottom sheet 85 %.
r3394 was not published: its noise check counted Firefox's own CORS log line for the refused request.

# Brief #4: duplicate chapters (branch `feat/duplicate-chapters`)

One source entry per scanlator for the same chapter (246 of Ethan's library series). Copies = chapters of the same
manga with the same chapterNumber >= 0; -1 (unparsed number) chapters are never copies of each other.

## What upstream already did, and what changed

Upstream's reader setting "Skip duplicate chapters" (default on) already (a) dropped copies from the reader's
next/previous list, preferring the scanlator the reader was opened with, else the lowest source order, and (b) sent
reader progress (lastPageRead, isRead at the end) to every copy. Gaps against the brief, now fixed
(`src/features/tsuji/duplicates/`):

1. **-1 chapters**: upstream grouped every -1 chapter as copies of one another, so reading one extra marked all
   extras read (and the delete-while-reading option would delete them all). Now each -1 chapter stands alone
   (`tsujiAddDuplicates`, `tsujiRemoveDuplicates` at upstream's three call sites).
2. **Manual marks** (chapter list, menus, "mark previous as read": everything through `Chapters.markAsRead`) now
   also mark the unread copies of the same numbers read: one fresh read of those mangas' chapters
   (`TSUJI_CHAPTER_COPIES`), then one update. Unmarking never touches copies. If the read fails, the chosen chapters
   are still marked.
3. **Resume** (manga screen FAB): the first chapter number with no read copy (server `firstUnreadChapter` would
   resume at the unread copy of a number already read on another scanlator). Copy choice: the scanlator last
   finished in the reader (manga meta `tsuji_readScanlator`, written by the reader when a chapter is marked read;
   needed because copies marked together get the same lastReadAt), else the furthest read chapter's scanlator,
   else the lowest source order. -1 chapters count alone. Scanlators excluded in the chapter list filter still count
   as read but are never picked (a number only they have is skipped).
4. Reader next/previous keeps upstream's reference (the chapter the reader was opened with), so after a detour to
   another scanlator for a missing number, the next numbers return to the opening scanlator.

Still tied to "Skip duplicate chapters" (upstream's setting, left as the owner set it): the reader's skip and its
progress-to-copies. Manual marks and Resume apply always. Not changed: the library card's Continue button uses the
server's `firstUnreadChapter` (cards don't load chapter lists); new reads keep copies in step, so it drifts only on
titles read before this change.

## Verification

- Unit (`duplicateChapters.test.ts`, 19): sibling marking (copies only, never another number, never -1, already
  read skipped), upstream-path grouping, reader list (current scanlator, else lowest source order; the current copy
  kept; -1 kept; a missing number just absent), resume (nothing read, first number without a read copy, a read copy
  counts, -1 alone, missing scanlator, lastReadAt tie, stored scanlator wins, excluded scanlators, JSON parsing, list
  not loaded yet).
- Browser (`tools/scripts/tsuji/duplicates.e2e.mjs`, in `test:tsuji:e2e`): read 1 on A to the end in webtoon mode ->
  the reader moves to 2 on A, 1 on B is read on the server, nothing else; Resume -> 2 on A; `tsuji_readScanlator` =
  "A"; manual "Mark as read" on 3 on A -> 3 on B read, nothing else; reading a -1 chapter leaves the other -1
  chapter unread. 9 checks pass; on the r3391 build 4 fail (Resume, stored scanlator, manual copy, -1 chapters): the
  reader skip and copy marking already passed there (upstream).
- Mock fixes (`mockSuwayomi.mjs`): chapter / manga `meta` are lists on v2.3.2243, manga meta stored, `chapters`
  honours `filter.id.in`, a chapter's manga lists the chapters.

## Acceptance (Cowork, live)

1. A series with two scanlators: finish chapter N on A in the reader -> next opens N+1 on A; N on B shows read.
2. Chapter list: mark a chapter read -> its other-scanlator copy shows read; mark it unread -> the copy stays read.
3. Manga page Resume: first number with no read copy, on the scanlator last read.

# Brief #3: For You (branch `feat/for-you`)

Discover's second tab. No spec beyond "taste profile + weekly rotation"; decisions below are Tsuji's (Makimono has
no For You ranker to port), the ranking reuses Makimono's shipped RecommendationRanker constants (`rank.ts`).

## Decisions

1. **Taste profile** (`forYou/tasteProfile.ts`): the configured AniList user's list (CURRENT, COMPLETED, REPEATING,
   PAUSED, DROPPED; Planned says nothing) with score, progress, last update and each title's tags, one request,
   cached a day. Entry weight = status (Rereading 1.2, Completed 1, Reading 0.8, Paused 0.3, Dropped -0.6) x progress
   (Reading/Paused ramp to full at 20 chapters) x score (80 = 1, 50 = 0, 95 = 1.5, 35 = -0.5; unscored = 1) x recency
   (half-life 180 days, floor 0.5). Profile = the 30 strongest liked content tags (no spoilers, no Technical);
   seed pool = the 30 strongest liked titles.
2. **Weekly rotation** (`forYou/weeklyRotation.ts`): everything that varies is drawn from a PRNG seeded with
   user + ISO week (local time, Monday start), so For You is stable within a week, identical on every device, and new
   every Monday: 4 seeds sampled by weight from the pool, 3 core tags (strongest) + 3 rotating tags (sampled from
   the next 12).
3. **Candidates** (`forYou/ForYouService.ts`): 3 AniList requests per week: the list, all 4 seeds'
   recommendations in one aliased request (20 edges each; if AniList rejects it, one request per seed with Similar's
   seed query), taste recall (40 popular titles with the core tags + 40 best-scored with the rotating tags). Edge
   signal = seeds' ratings summed, each scaled by how much the user liked that seed. Titles on the list and the seeds
   are never recommended. Cached until next Monday (1 h if half of AniList's answer is missing).
4. **Ranking** (`forYou/forYouCandidates.ts`): `rankCandidates` with the taste profile as the seed tags (edge 0.5 /
   tag cosine 0.3 / Bayesian quality 0.2, agreement blend, MMR), then this browser's top 12 of last week x 0.85
   (localStorage `tsuji_forYouShown`, 3 weeks), so the head changes weekly even when seeds overlap.
5. **UI** (`forYou/components/ForYouTab.tsx`): caption (week, list size, "New picks every Monday"), taste chips,
   Refresh (refetches list + week, same seeds), the shared filter bar (Hide what's on my AniList, Hide what I've
   started, types, statuses, ...; hidden gems and tag filters are Similar-only), Top picks (24), then "Because you
   read {seed}" rows (12 each, by that seed's rating). Cards, marks, badges and the preview are Discover's.
6. **No upstream change**: the tab replaces the stub inside `Discover.tsx` (a tsuji file).

## Verification

- Unit: taste weights, profile tags / seed pool, list parsing, ISO weeks (year boundary), per-week determinism and
  rotation over 52 weeks, tag picks, merge / exclusion / edge sums, ranking + last-week demotion, seed rows, history,
  service (3 requests, week cache TTL to Monday, partial answers, per-seed fallback, empty list, refresh).
- Browser (`tools/scripts/tsuji/for-you.e2e.mjs`, in `pnpm test:tsuji:e2e`): production build, mocked Suwayomi and
  a fixture AniList; the tab renders top picks + 4 seed rows from 3 requests, the shared title leads, listed titles
  never appear, the Planned badge shows, a reload is served from the week cache, Refresh refetches, no page errors.
  First run caught untranslated Lingui ids in a build made before `i18n:extract` (the commit hook runs it).
- AniList itself is not reachable from the coding container (network allowlist), so the three new queries were not
  run against the real API here: Cowork's browser check is their first live run.
- Harness fix: `reader-resume.e2e.mjs` waited 20 s for the target image in the "after the 10 s limit" scenario,
  which needs ~22.5 s on a slow machine (fails the same way on the shipped r3389 build); now 60 s.

## Acceptance (owner / Cowork, real browser)

1. Discover > For You shows the week's caption, taste chips that look like ejustice's taste, Top picks and 4
   "Because you read ..." rows within a few seconds (3 AniList calls; later visits this week: none).
2. Nothing on the AniList list as Reading / Completed / Dropped / Paused shows; Mark as read hides a card.
3. Same picks on another device this week; Refresh keeps the same seeds.

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
