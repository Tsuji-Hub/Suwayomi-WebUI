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

# #21 follow-up: unlinked Comick entries (branch `feat/comick-dedupe`)

**Built** (2026-10-29). Not shipped. On `custom` r3455.

/manga/438 Similar showed "Starting As The God Of Wealth, Taming Billions Of Divine Pets!404" as a CK card (r3447,
r3456, r3457 checks). That Comick entry has no AniList link, and Comick's other entry for the series
(`kaiju-zhuanzhi-caishen-xunhua-yiwan-shenchong`) has none either; AniList has it as 202246 (romaji "Kaiju Zhuanzhi
Caishen, Xunhua Yiwan Shen Chong!", native 开局转职财神，驯化亿万神宠!, the English title a synonym, score 54).
"Wang You: Gua Ji Baiwan Nian, Wo Xinglai Cheng Shen" is a different series. r3456 / r3457 assumed a linked Comick twin
(the r3457 fixture even made "Wang You" that twin); live there is none.

**r3458 check:** still a CK card; no AniList title search fired. Cause: the lookup searched Comick by the card's
`romaji`, which for a Comick recommendation is its first alternative title (here the Traditional Chinese
開局轉職財神，馴化…); Comick returned nothing, the entry's row was never found, and the lookup stopped before AniList. The
fixtures had recommendations without `md_titles`, so they never hit it. Now Comick is searched by the shown title, then
the next one, and AniList is asked even when Comick's search never returns the entry (by the card's own titles).

`loadComickRecInfo` (cache `comick:slug:v4`), for a recommendation whose search row has no AniList id, or no row:

1. A linked row in the same Comick results sharing any title (title or `md_titles`, any script) lends its id, title,
   page and cover; one more Comick search by the original-language title when the first has none.
2. Else AniList by title: the row's titles (or the card's, without a row) with a junk number glued to punctuation
   stripped ("Pets!404" -> "Pets!"; "Room 1408" stays), Latin ones first (AniList's native titles are often Simplified
   where Comick's are Traditional); only an exact title / synonym / native match counts (any script). The card then carries the AniList id and the clean title. At most two AniList searches, only for unlinked
   entries, skipped while AniList is down; a miss or a failure is retried after a day, a hit kept a week.

Cards then collapse by AniList id as before. Two series sharing no title stay separate. Tests: unit (junk number,
search titles, synonym and native matches, a partial title rejected, different series kept apart),
`similar-freshness.e2e.mjs` with the live shape (recommendations with Traditional `md_titles`, Comick's search
returning nothing for the entry; fails on r3458 exactly as live; passes: one "...Divine Pets!" card, AniList 54, no CK,
"Wang You" its own 49 % card, Top rated non-increasing, the lookup cached on reload, the trace).

**Live trace:** `localStorage.setItem('tsuji:debug', 'comick')`, reload: the console shows each lookup's steps
(`[tsuji comick-rec] <slug>: Comick search "...": no row`, `AniList search [...]`, the result).

## Acceptance (Cowork, live)

/manga/438 Similar: no "...!404" CK card; "Starting As The God Of Wealth, Taming Billions Of Divine Pets!" at AniList
54, no CK; "Wang You" still its own card; Top rated non-increasing. The v1 / v2 lookups are ignored, so the first visit
redoes them.

# Brief: translated drop notes (branch `feat/drop-notes-translated`)

**Shipped** as r3455-2668b4e1 (2026-10-29; Cowork: KoMA ch 67 pass live on r3456). Off `custom` (r3453).

al-drops translates non-English reader notes on the server: a note may carry `tr: true` (`text` is the English) and
`orig` (the reader's words). The Readers notes show a muted "· translated" after the chapter tag; tapping it switches
that note between the English and the original (local state, no request). `orig` counts only with `tr`; other notes
render as before. Files: `drops/drops.ts` (`DropNote.orig`), `drops/components/ReadersBlock.tsx`. Tests: unit (parse),
`drop-rate.e2e.mjs` (a Portuguese note: English shown, tap, original, tap back, no request).

## Acceptance (Cowork, live)

King of Martial Arts (AniList 119602): the ch 67 note in English with "· translated"; a tap shows the Portuguese
original; request count unchanged.

# Brief #20: Drop rate + drop map (branch `feat/drop-rate`)

**Shipped** as r3453-8f252040 (2026-10-26; Cowork: r3452 checked live, D1 fixed after it). Off `custom` (r3446), `custom` r3447 merged in.

**Backend (Cowork, al-drops on CT100):** `<relay>/drops/<anilistId>` (AniList's status distribution, a map of where
the latest 400 public DROPPED lists stopped, up to 15 reader notes; `map.state` ready / pending / refreshing; 404 /
503 = no data) and `<relay>/drops/index.json` (drop % and starters of every cached series, the library median). The
relay base is `tsuji_commentsRelay` (as comments and the MTL feed). drop % = DROPPED / (CURRENT + COMPLETED + DROPPED +
PAUSED), recomputed from `dist`.

**Done:**

1. **Series page "Readers" block** (`drops/components/ReadersBlock.tsx`, under the buttons, lazy, hidden without
   data): "3.2 % dropped" (tooltip "7,736 of 243,525 readers who started it (AniList)") with low / typical / high vs
   the index median (< 0.75x, > 1.5x), "58 % finished · 4 % on hold"; the drop map (a bar per bucket, cliffs in orange,
   a marker at the last read chapter, `data-marker`); "Most drops: ch 106-120 (12 %) · 17 % quit in ch 1-15 · half of
   droppers quit by ch 80" (the biggest cliff; the early bounce only at 10 %+ of mapped droppers; the median floored);
   the sample footer and "Droppers rated it 50/100". Reader notes collapsed; past the last read chapter blurred
   behind "Show notes past ch X". Pending: the rate at once and "Mapping where readers drop… ~30 s", polled every 5 s
   for 2 minutes (AniList's rate meanwhile when the relay has no numbers yet); refreshing: the old map. Under 5 mapped
   drops: "Not enough drops to map". Relay down (no answer): AniList's statusDistribution, one request, no map.
2. **Cards:** "▼3%" (200+ starters only, band colours) on library cards (AniList id from `tsuji_anilistId` or the
   AniList track record: `TSUJI_MANGA_DROP_FIELDS` in the library fragment) and recommendation cards, all from one
   `index.json` request per 10 minutes.
3. **Library sort "Drop rate"** (`tsujiDropRate`): lowest first (highest first descending), unknowns last.
4. Nothing in the reader; everything lazy, nothing blocks a render.

**After the r3449 check (Cowork):**

1. **Preview line** on every preview surface (the long-press / right-click dialog and the card's hover tooltip):
   "▼ 3.2 % dropped · most quit ch 106-120" ("most quit" only with a cliff), whatever the starter count. From
   `index.json` (its cliffs are `[from, to, share %]`: the largest share, the first one without shares), else one shared
   `GET /drops/<id>` per title and session that the preview closing never cuts (30 s client timeout: a cold title makes
   the relay ask AniList first; r3452 gave up at 8 s, relay 499, then asked AniList too). AniList's rate only on a relay
   error or timeout; nothing on a 404; still mapping: nothing, and a fresh request on the next open.
2. **Under 200 starters** the Readers block shows "x % dropped" without low / typical / high (the chips' threshold).
3. **Two cliffs** are both named, by chapter: "Most drops: ch 21-60 (12 %) and ch 121-160 (9 %)".
4. `tsuji_anilistId` on a non-library series: written by Similar since brief #1 (the resolved id, saves the title
   search next time), not new in #20; #21's library index reads `inLibrary: true` mangas only, so it never hides them.

**Tests:** unit (`drops.test.ts`: Solo Leveling's live answer, the summary, few drops / pending, the marker on an
ongoing series, notes split, AniList fallback, bands, index, AniList id, the sort). Browser `drop-rate.e2e.mjs`:
Solo Leveling (rate, low, 14 bars with the 106-120 cliff, marker at 110, summary + footer, notes), Mythic Item
Obtained (7.1 %, median 107, ongoing), pending map arriving without a reload, "Not enough drops to map", library (one
index request, chips, none under 200 starters, the sort), Discover (no per-card request), a hover tooltip (the index line by largest share, no request), a short hover on a cold title (9 s relay: not cut,
one request, cached, no AniList call), still mapping (no AniList call), a preview outside the index (one `/drops`
request, cached), 150
starters (no band), two cliffs named, relay down (AniList's rate, no map), no app errors.

# Brief #21: Similar / Discover fixes (branch `fix/similar-freshness`)

**Shipped** as r3447-649a407c (2026-10-26; Cowork: acceptance 1-7 pass live). Off `custom` (r3446).

**Hide rule, one for every card source.** A Comick card gets its AniList id (search rows carry
`external_ids.anilist`; `links.al` on comic pages) and goes through the same `passesFilters` as AniList's: in the
library (an AniList / MAL track record **or the `tsuji_anilistId` meta**, new) or on the list as Reading, Rereading,
Completed, Paused or Dropped. Planned unchanged. Comick's recommendations (`relates`) carry no AniList id, so each of the
top 20 is looked up once by its title (`comick:slug:v1:<slug>`, a week; a miss a day) and keyed by the row with its
slug. A Comick card for a series AniList already shows is dropped; its chapter date goes to the AniList card.

**Top rated, one list.** Comick cards with an AniList id take AniList's `averageScore` (else `meanScore`) and
popularity from one `TsujiScores` request per rail (`Page(perPage: 50) { media(id_in) }`, `al:score:v1:<id>` a day,
misses too). Comick-only cards keep bayesian x 10 with a "CK" on the score badge. Sort: score, then popularity,
unknown scores last (`sortByMergedScore`). The scores land before the filters, so min score and Hidden gems use them.

**Freshness tag** above the status on ongoing / hiatus cards: "> 6 MO" (6-12 months, `stale6Months` amber) and
"> 1 YR" (12+, `stale1Year`). Date: the Comick card's `uploaded_at`, else for an AniList card near the screen one Comick
title search a day (`comick:fresh:v1:<id>`, the row with its AniList id). Nothing for finished series.

**Pivot from the brief:** MangaBaka has no Comick link and no last-chapter date (`published.end_date` /
`last_updated_at` only), so the lazy date is a Comick search by title instead of MangaBaka -> Comick page; Comick
recommendations need one cached search each. MangaBaka was already `api.mangabaka.org` everywhere (the `.dev` host
only serves images); a 5xx is silent. The library latest-chapter source is skipped: library cards are hidden by default.

**Files:** `recs/mergedScore.ts`, `recs/aniListScores.ts`, `recs/useCardFreshness.ts` (new);
`comick/comickCatalog.ts` (`getComickAniListId`, `uploaded_at`), `comick/ComickService.ts` (`loadComickRecInfo`,
`loadComickFreshness`), `similar/useComickRecs.ts`, `similar/SimilarSection.tsx`, `recs/components/RecCard.tsx`,
`recs/filters.ts` + `TSUJI_LIBRARY_INDEX` (meta), `Tsuji.palette.ts`. No upstream file.

**Tests:** unit (merged score, CK, freshness bands, `external_ids` / `uploaded_at`, library meta id); e2e
`similar-freshness.e2e.mjs` (hide by meta and list, dedupe, Top rated order, CK, both tags, lazy lookup, one score
request and none on reload, no `.dev`, MangaBaka 503, Discover hides the same). `discover-tags` preview check now
ignores other cards' freshness searches.

## Acceptance for brief #21 (Cowork, on the server)

1. /manga/438: 133070 and 163824 not in Similar.
2. Top rated: scores never increase down the row, Comick cards mixed in.
3. A Comick-only card shows "CK" after its score.
4. Ongoing cards: "> 6 MO" / "> 1 YR" where the latest chapter is that old; none on finished series.
5. One `TsujiScores` request per Similar rail (DevTools, `id_in`).
6. No request to `api.mangabaka.dev` from the app.
7. Discover / For You hide the same titles.

# Fix: MTL read-ahead in the reader (branch `feat/mtl-readahead`)

**Shipped as r3446** (2026-10-26). Off `custom` (r3444).

The engine translates the next raw chapter by itself once one is read (brief #19 backend note), so it appears after
the reader loaded its chapter lists (Apollo is cache-first): at the end of MTL 227 the reader said "There is no next
chapter" although MTL 228 was ready, and the card had asked the engine once, before the read-ahead started.

1. While the reader sits at the end of a chapter whose next number neither English (filter) nor the MTL list has and
   the raw has, the engine is asked about it every 15 s (every 3 s once queued / running); when it is readable the MTL
   chapter list is fetched again, so Next, the inline rows and the card see it (no request is ever sent for it).
2. The MTL reader shows the "English ran out" card too when the next number has no English and no MTL chapter yet
   (Translate & read, or Read MTL once the read-ahead has it); "The next chapter is in English" gives way to it.
3. The series' MTL chapter list is asked again on every visit (cache-and-network).

**Tests:** `english-ran-out.e2e.mjs`: MTL 228 published by the fake engine while MTL 227 is open and at its end; Next
is 228 within 30 s, nothing requested for 228 (fails on r3444).

# Brief #19: "English ran out": translate and keep reading, in place (branch `feat/english-ran-out`)

**Shipped as r3444** (2026-10-25). Off `custom` (r3441). r3443 checked live (6/6); fixes below.

**Backend (Cowork, mtl-engine v7):** `tsuji_raw_links` raw entry carries `api` (the relay, `.../mtl`) and `req` (a
series-level signature); `kind:"align"` is the art match (`en`, `en_source`, `raw`, `last_raw`, `verdict`, `ok`,
`next_raw`; floats). `GET {api}/s?raw=&ch=` = none / queued / running / partial / ready (+ `url`, the MTL chapter's
reader route; only its path is used); `GET {api}/req?raw=&ch=&sig=` queues it (403 on a bad signature); `GET
{api}/align?raw=` the report.

**Done:**

1. **Reader end card** (`TsujiReaderRawLayer`, `EnglishRanOutPanel`): when the next number (current + 1) has no
   English chapter in the scanlator filter and the raw (numbering from its names) or the MTL has it, a card at the end
   of the chapter (vertical: 90 % scrolled; paged: last page), in place of "There is no next chapter": "Ch 225 isn't in
   English yet. Raw is out (如漫画).", the art-match line ("✓ Raw 225 follows Asura 224 (art match)" when `ok` and
   `next_raw` is that number, else "⚠ <verdict>", nothing without an align entry), and Translate & read / Read raw /
   Compare. `/s` once when the card mounts; `ready` / `partial` (or the MTL list having it) makes it "Read MTL 225" with
   no request. Translate & read calls `/req`, then `/s` every 3 s in the card ("Queued (position 1)…", "Translating… 10
   / 191 pages · 1:35", a progress bar); Read now as soon as `url` appears, opened by itself while the card is on
   screen (kept mounted while hidden, so it keeps following). A 403 shows "Couldn't request a translation." and is
   never retried; an engine that doesn't answer shows Retry.
2. **Partial MTL chapter:** on an MTL chapter whose `/s` is partial (or running with a `url`), "Pages 11-191 are still
   being translated… (10 / 191)" at its end, polled; on `ready` the chapter's pages are fetched again in place
   (`useTsujiChapterRefetch`, the reader resumes at the page last read).
3. **Chapter list:** the Missing row lists each missing number the raw or the MTL has (10, then "Show N more") with the
   same panel; the chapter menu gets Read raw, Translate raw (MTL) (the panel in a dialog) and Compare with raw, next
   to WebView, when the raw has that number.
4. **MTL inline:** MTL chapters whose number has no English chapter in the filter sit in the English list by number,
   with an MTL badge and their own read state (the list's unread / downloaded / bookmarked filters apply); English for
   that number in the filter hides it. Reader Next / Previous go 224 -> MTL 225 -> 226: the reader only knows one
   series, so the other series' chapters ("foreign", `mtlSequence.ts`) are kept beside it; where one comes next (a tie
   with an English copy outside the filter goes to the MTL; in the MTL reader English wins), the reader's list is cut
   there (infinite scroll stops, the card shows) and Next / Previous open it (`ReaderControls.openChapter` guard; the
   buttons count it). Opening another series' chapter drops the reader's chapter state first (the reader stays
   mounted across series and would keep the old list) and refetches a new MTL chapter's list (Apollo is cache-first).
   The MTL -> English link is remembered in this browser (`raws:mtlParent:v1:<mtlId>`; the meta only links English ->
   MTL).
5. **Series page:** under the Raw chip, "✓ Raw matches English (Asura 224 = raw 224)", "⚠ Raw upload is incomplete
   (stops at 28% of the English chapter)" (verdict says INCOMPLETE; the percentage is `last_raw`), or "⚠ <verdict>";
   "details" opens `{api}/align?raw=` formatted (plain values, each list of records as a table).

**After the r3443 check (6/6 pass):**

1. **Partial -> ready kept the page:** the reader reloaded the chapter's 59 pages and started at page 1 (it reloads
   pages from scratch: its first page or lastPageRead). Now `refetchChapterPagesInPlace` notes the page being read and
   the offset in it, holds lastPageRead writes until the new pages are in, then pins that spot like a resume
   (continuous vertical) or selects the page (other modes).
2. **MTL 225 opened directly:** Next went to MTL 226; the MTL -> English link was only known after visiting the
   English series in this browser. Now the reader looks it up once (`TSUJI_MTL_PARENTS`: library series whose title
   is the MTL title without " [MTL]", whose `tsuji_raw_links` name this MTL series; the copy read last when several do)
   and remembers it.

Replaced: the #6 end-of-release offer (feed `t_next` in a frame) in the reader. Only `tsuji_raw_links` is read; only
the meta's `api` host is contacted; nothing is written to Suwayomi meta.

**Tests:** unit (`englishRanOut.test.ts`: the meta's `api` / `req` / align, both alignment lines, engine answers, the
cut for 224 / 226 / MTL 225, inline rows, the client's URLs, a 403 is final). Browser `english-ran-out.e2e.mjs` (The
Game That I Came From, unofficial filter, fake engine): series line + report, inline MTL 225 between 226 and 224, the
Missing row for 227 / 228, the chapter menu, end of 224 "Read MTL 225" with no request, Next from MTL 225 to unofficial
226, Translate & read on 227 (queued, "Translating… 2 / 9 pages · 1:35", opens by itself), the partial note and the
full page list without a reload and still on the page being read (fails on r3443), MTL 225 opened directly with Next
to unofficial 226, a bad signature once and no polling, the official filter hiding MTL 225, only the
relay's `/mtl/` paths, no meta writes. `raws.e2e.mjs` updated for the new card.

# Brief #18: For You fixes from the #14 recheck (branch `feat/foryou-speed`)

**Shipped as r3441** (2026-10-22). Off `custom` (r3439).

**Done:**

1. **Top picks back.** Cause: the week's 4 seeds come from the 30 strongest liked titles, all among Best matches' 40,
   so their edges were all in Best matches; and the recall asks for the most popular titles with the distinctive
   tags, which are the tags the user reads most, so they were all on the list (r3439 week: 47 candidates, every one
   hidden or already in Best matches). Now Top picks rank every edge (the 40 strongest titles' too; a week seed's
   edges counted once), and the recall sends `id_not_in: <list ids>`. Up to 160 candidates kept. Week key
   `foryou:week:v6` (a v5 week is rebuilt once).
2. **Best matches first.** The 5 Best matches requests go into the AniList queue before the week's seeds and recall,
   and the tab shows Best matches as each batch comes in (`onProgress`, `isPending`; never stored), with card
   skeletons where Top picks and the seed rows follow. Family lookups and MangaBaka paging start only once the whole
   week is in.
3. **Family row in the same visit.** Its 60 lookups have their own queue, one per 2.1 s (under MangaBaka's 30/min;
   6 at a time drew 429s, so 45 of 60 stayed unknown and the revisit asked again): about 2 min cold, each answer
   cached a month as it comes in (a reload keeps what is done). "Finding more like your favourites..." shows until
   the row is in. A row whose lookups partly failed is not stored (the next visit asks only for those). A stored row
   shows at once on a revisit (read synchronously, no 1 s delay, 0 MangaBaka requests).

**Tests:** unit (every edge in the candidates, Best requests queued before seeds and recall, progress before the
week, recall `listed`, everything failing is an error). Browser `for-you.e2e.mjs`: Best matches visible while the
seeds and recall are held 4 s, Top picks 10+, the placeholder, 10 lookups with no 429 from a fake MangaBaka that
answers 429 to lookups under 1.5 s apart, the stored row on reload within 1.5 s with 0 requests, key v6.

# Brief #17: hide "on my list" titles while AniList is down + Similar's raw Comick titles (branch `feat/al-list-cache`)

**Shipped as r3439** (2026-10-22). Off `custom` (r3438).

**Done:**

1. **Saved list:** when the list load fails (`loadMyList`), the newer of this browser's last AniList list (a month,
   #15) and the server's copy in global meta (`seen/alListCache.ts`: the `tsuji_alListCache` index is read first, the
   parts `_0.._<parts-1>` are joined only when the count matches, the user must match; rows
   `[id, status, progress, title]`) becomes the list in use, so Similar, Discover and For You hide by AniList id as
   usual. Its titles join the title index, so Comick cards without an id are matched by normalized title. Read with
   one network-only global meta query, only on failure; never written by the WebUI. The live list takes over again
   when AniList answers.
2. **Note** (`MyListNotice`): "AniList is down: hiding titles from your saved list (<relative>)." with a saved copy;
   the old "Couldn't load ... nothing is hidden." without one.
3. **Similar's raw Comick titles:** the cause was the comic-page cache `comick:comic:v1`, saved on r3434 as finished
   cards with Comick's raw titles (r3435's title rule only applied to new parses). Now `comick:comic:v2`; a
   recommendation with only `title` + `slug` gets the slug's name ("00-solo-leveling" -> Solo Leveling).

**Tests:** unit (split parts, per-part arrays, half-written / other user / unreadable = none; a recommendation with
only a slug). Browser `anilist-down.e2e.mjs`: a server copy newer than this browser's hides "Rec 305" in Similar
with the saved-list note, Solo Leveling by name in Similar's Comick cards, no saved-list note once AniList is back.

# Brief #16: "Compare translations" card on the series page (branch `feat/tl-compare`)

**Shipped as r3438** (2026-10-22, with #16b). Off `custom` (r3435).

**Done:**

1. **Card** (`tlCompare/components/TlCompareCard.tsx`, mounted by `TsujiSimilarSection` under the description, lazy):
   the manga meta `tsuji_tlCompare` (VM110 `tlcompare` v2) when `status = ok` with 2 variants: "Two English
   versions on <source>", columns headed "<variant> · <first group>", rows Made by (group or Unknown; the per-chapter
   line collapses runs of the first name: "ch 1-200 Asura Scans · 251 Manhwa Freak · 301-351 UTOON (re-upload
   site)", re-upload sites muted), Same thing, different word (up to 5, drift notes "<variant> also uses "<word>" in
   ch ..."), Words only one uses (up to 6 chips each, "heavenland ×8"; hidden when both empty), Translator notes ("3
   in 8 chapters" / "none"), Pages (width range), Chapters; footer "Sampled ch ... · checked <relative> · one-off
   wording slips in other chapters won't show here · Re-check".
2. **Read <variant>:** sets the existing chapter option `excludedScanlators` to the other variant (the chapter list,
   Continue, next chapter and download-ahead follow it); "Showing only <variant> chapters · Show all" (clears it); the
   active button is filled.
3. **No result, 2+ scanlators:** "Compare translations" writes the global meta `tsuji_tlRequest_<mangaId>` = epoch
   seconds; "Checking… up to 30 min. You can keep browsing."; the manga meta is polled every 30 s
   (`GET_MANGA_META`, network-only) until a result at least as new as the request (2 min clock slack) lands. A
   request key already on the server (another device, the service's own 7-day run) shows "Checking…" too.
4. `single-upload`: nothing. `error`: "Couldn't compare: <error>" + Retry. `v: 1` (or no `v`): only "Re-check
   translations". Works for any manga id (not in the library too). Only Suwayomi meta is read and written.

**Part 2 (brief #16b, same branch; the service's v2 now writes `votes`, matched `terms` with `how` / `seen`,
leftover `onlyA` / `onlyB`, `skipped`, groups led by whoever made the most sampled chapters, human `error` text):**

1. "Readers' pick" above Made by when `votes` is present: a split bar across both columns sized by `pctA`, each
   side's % under its column, the bigger side in the accent colour; "Upvotes on Comick, <n> chapters both have",
   plus "· <variant> came out first on most of them, which pulls votes its way" when `firstA / chapters` >= 0.8
   (or <= 0.2 for the other). No "better" / "winner". `votes: null` = no row.
2. "Same thing, different word" as matched rows: Title Case `a` -> `b` across the columns ("Heavenland ->
   Tianyong Land"), under it "same spot in 7 of 9 places" (`aligned`), "same word root" (`stem`) or "matched by
   the local model, check it" (`model`); the drift notes stay. "Other words only one uses" holds the leftovers.
3. Footer: "· ch <list> skipped (pages failing)" when `skipped` isn't empty. Phone width keeps two columns.

**Tests:** unit on the live 3526 value (parse, group runs, views, request matching, scanlators, active variant).
Browser `tl-compare.e2e.mjs` (mocked Suwayomi only): the card with every live value, re-upload names muted, Read
unofficial = 3 of 6 rows and only `webUI_excludedScanlators` written, Show all = 6, Compare -> request written ->
card after the 30 s poll without a reload, single upload = nothing, v1 = Re-check only.

# Brief #15: keep Discover, Similar and For You working when AniList is down (branch `feat/anilist-fallback`)

**Shipped as r3435** (2026-10-21). Off `custom` (r3432); r3434 checked live during the real AniList outage, fixed in
r3435.

**Done:**

1. **AniList health** (`services/aniListHealth.ts`, wired into `AniListClient`): down = 403 saying the API is
   disabled, a 5xx, a network error, or no answer within 8 s (timeouts of 12 s requests; 4 s ones stay
   DegradedMemory's "slow"). Remembered 30 minutes in sessionStorage; meanwhile requests are refused without going
   out (`AniListDownError`), also ones queued before the failure, except one probe every 5 minutes and one right
   after a page load (a reload is "try again"). `useAniListHealth` re-renders on changes and sends the due probe.
   An empty Trending alone is not "down" (Popular from AniList still fills the landing, as before).
2. **Comick catalog** (`comick/`): through the comments relay (`/comick/`, own queue: 0.6 s after a burst of 10,
   about 100/min under the relay's 120). Search pages for the session, comics (AniList id + 30 recommendations) a
   week, AniList id -> slug a month (a title search, English then a synonym; only a hit whose `links.al` is the id
   counts). Cards: `bayesian_rating` x 10, follows as popularity, MangaDex genres + MangaUpdates categories as tags,
   status / year / chapters (`last_chapter`), adult = erotica / pornographic, keyed by `links.al` or a negative id,
   "via Comick" on the card.
3. **Comick cards and the list:** search hits and recommendations carry no AniList id, so `TsujiMyList` now also
   reads titles; a title index (normalized title hash -> AniList id, `myList:titles:v1`) gives a Comick card the id
   of the list title it matches (list state, read marks, badges and hiding then work). The last list is kept 30
   days (`myList:last:v1`) and used when AniList fails.
4. **Discover:** while down, landing Trending = Comick `view`, Popular = `follow`, other sorts `rating` /
   `created_at`; types (`country`), one status and min chapters go to Comick, the rest client side; 100 a page. With
   chips, the search runs on MangaBaka; an AniList-only chip with no MangaBaka tag is left out and reads
   "(not available while AniList is down)". The tag catalog failing while down = MangaBaka suggestions only. Feeds
   restart when AniList goes down or comes back.
5. **Similar:** Comick's recommendations always, after AniList's and MAL's, by votes, deduped by AniList id then
   normalized title (`comick/comickExtras.ts`); the seed's titles come with the seed query now (`similar:v2`). Down:
   nothing from AniList (uncached), Comick + the MangaBaka fill; the fill counts Comick's cards.
6. **For You:** the last profile kept 30 days (`foryou:taste:last:v1`); down = Best matches from Comick's
   recommendations of the 40 strongest liked titles (votes x seed weight, list and seeds left out, cards matched to
   the list by title), cached an hour (`foryou:comick:v1`), note "AniList is down: picks from Comick, based on your
   list from <date>." The family row works as before (MangaBaka).
7. **Note:** one line on Discover / For You / Similar while down; a click shows AniList's last answer and the next
   try. No toasts.

**Fixed after Cowork's r3434 check** (live during the real outage: landing 346 Comick cards, RTP Similar 24,
Investor 12, no library titles, no 429s through the relay at 120/min):

1. For You without a saved profile was the error screen (Ethan's state: r3432 moved the cache versions, AniList
   down since). Now, while down: the last list's profile (a month), else the day-long profile cache, else the
   Suwayomi library's most read titles (started only, read chapters as weight; AniList track id -> verified Comick
   slug, else a title match >= 0.85) -> Comick's recommendations, else Comick trending ("Trending on Comick").
   Each with its note; the error screen only if Comick fails too. Key `foryou:comick:v2`.
2. Comick titles: the English one. An English `md_titles` entry close to the slug (Solo Leveling for "I am the only
   the one who levels up", Omniscient Reader's Viewpoint for "ORV"), else the slug as a title when Comick's own
   title shares little with it, else Comick's title; Comick's title stays as the alternative for matching. A card
   with AniList details keeps AniList's English title, else MangaBaka's, before a romanized one.
3. Tag catalog: the last one kept 30 days (`tagCatalog:last:v1`); with none, AniList's genres and the snapshot's 248
   tags are built in, so AniList-only chips stay pickable and show the marker.

**Tests:** unit for the down signals, probe gating (client and store), Comick card mapping, search parameters,
comic parsing, list-title matching, Similar extras dedupe, For You merge, Discover falling back. Browser:
`anilist-down.e2e.mjs` (AniList route-aborted: landing 184 Comick cards in about 2 s with Ethan's filters sent,
no library / list / erotica title, the note and its details; System + Medicine on MangaBaka with the marker;
Similar 22 cards with "via Comick" and the fill; For You Best matches with the dated note; AniList 3 requests at
the landing and one probe per page load; Comick 15 requests; then AniList back: AniList cards, no note, Similar
merged without duplicates).

**Known limits:** a Comick card that matches no list title (by its English / romanized title) keeps a negative id:
read marks on titles that are not on the list can't hide it. Comick search hits carry no `links`, so most landing
cards are such cards; list titles are still hidden through the title index.

# Brief #14: put the tag work to use in ranking (branch `feat/smarter-ranking`)

**Shipped as r3432** (2026-10-21). Off `custom` (r3429); r3431 checked live, fixed in r3432.

**Done:**

1. **Best match = chip fit + taste** (`recs/bestMatch.ts`, both engines; replaces `rerankByIncludeTags`). Fit = share
   of the included chips a card matches: AniList tag chips by rank / 100 as before; MangaBaka chips (a family through
   any member) count as matched for every series a sub-search returns, because each sub-search ANDs one tag of every
   chip (`getBakaFitChips`; no per-series record needed); AniList-only chips left as a post-filter score on the
   card's AniList details; AniList genre chips are matched by the genre search. Taste = sum(weight x rank / 100) over
   the card's content tags, normalized 0..1 per page, from For You's cached weights only
   (`foryou:weights:v1:<user>`, 30 days; Discover never fetches a profile). Score = 0.6 fit + 0.4 taste; without
   weights, fit alone. Ties: AniList popularity (AniList engine) or MangaBaka's order (MangaBaka engine). Each page
   ranked on its own. On MangaBaka with Best match and weights (or an AniList-only include chip), a page waits for
   its AniList details before it shows, so cards don't jump (`useBakaFeed` `waitForDetails`).
2. **Distinctive tags** (`forYou/distinctive.ts`; superseded by fix 1 below): weight = total x clamp(lift, 0.5, 3),
   lift = liked share / baseline share. Baseline = tag share of the week's whole merged pool (weekly candidates + every Best match, 200+ titles),
   else the committed snapshot `forYou/tagBaseline.json`, else no lift. **The snapshot is empty** (this container
   can't reach AniList): run `node tools/scripts/tsuji/build-tag-baseline.mjs` (20 AniList requests, 2.5 s apart) and
   commit the JSON. The week's recall tags are picked before the week's pool exists, so they use last week's pool
   baseline (`foryou:baseline:v1:<user>`), else the snapshot. Profile now carries `tagStats` (120 tags with weighted
   total and liked-title count), `likedCount`, `familySeeds`; keys bumped to `foryou:taste:v3` / `foryou:week:v4`
   (one rebuild of the week on deploy).
3. **"More <Family>"** (`forYou/familyRow.ts`, `FamilyRowService.ts`): after the week shows, the 60 strongest liked
   titles are looked up on MangaBaka (`GET /v1/source/anilist/{id}`, its `tags_v2` ids and parents;
   `baka:families:v1:<id>`, a week; the 180/min queue). A family on 5+ of them qualifies; one a week, qualifying
   families take turns by ISO week. Its member tags are searched (one search each, all comic types, safe ratings),
   merged by MangaBaka popularity without list titles, AniList details for the first 100 (2 `id_in`), ranked by
   Best match (all match, so by taste), 40 kept (`foryou:family:v1:<user>:<week>`, until Monday; partial = 1 h).
   Row: after Top picks, up to 20, same filters and seen marks, never a library title, nothing Best matches or Top
   picks show, quality floor (score or 1,000+ users).
4. **Similar fill** (`similar/sameTags.ts`, `SameTagsService.ts`): under 12 visible cards, MangaBaka fills in: the
   series by AniList id, its 3 most distinctive tags (lowest `series_count`, 25+ series, core / defining /
   recurrent before weaker), one search for any of them (`tag_mode=or`, all content ratings), ranked by tags shared
   (a subtag counts for its parent) then popularity, AniList details in one `id_in`; 30 kept a week
   (`similar:sametags:v1:<id>`). Shown under "Same tags as <title>", total capped at 24. 2 MangaBaka requests per
   title.
5. **One hide rule:** `LibraryIndex` is every library title, started or not; the filter reads "Hide what's in my
   library" (same `hideInLibrary` key). Applies to Discover, Similar and For You; read marks and Not for me stay.

**Fixed after Cowork's r3431 check** (passed live: 1, 2, 6, 7, 8; snapshot committed from the PC, 500 titles, 248
tags):

1. Taste weights: the pool baseline shared Ethan's bias (Male Protagonist 62 % of the pool vs 58 % liked, #2).
   Baseline is now always the snapshot, weight = total x lift^2, lift clamped 0.33..3 (Cowork's simulation on the
   cached stats: Male Protagonist #7, 5 of 7 distinctive tags in the top 15). Pool baseline code removed. Keys
   `foryou:week:v5`, `foryou:weights:v2`.
2. Family row: built after the cards show (1 s later), never cancelled by leaving the tab (one build per user and
   week, joined on return), shown in the same visit. Lookups 6 at a time (`lookupQueue`), cached 30 days. Member
   searches page on (max 3 pages) until 10+ cards pass the tab's hide rules; AniList details 50 a request, each
   tried twice; a card's English title is AniList's, else MangaBaka's, before a romanized one. Key
   `foryou:family:v2`.
3. First open: the row's lookups no longer overlap the week's AniList requests (e2e checks the order).
4. Similar fill: tags by tf-idf (MangaBaka weight core 1 / defining .75 / recurrent .5 / incidental .25 x ln(N /
   series count), 50+ series); one search per pair of the 3 tags (both tags), so every card shares 2+; searches stop
   once enough cards pass Similar's hide rules (at most 4 searches + the lookup; usually 1-2). Key
   `similar:sametags:v2`.
5. Best match with a taste: 0.5 fit + 0.3 taste + 0.2 popularity percentile on the page (ties share the mean rank,
   unknown = 0). Without a taste: chip fit, as before.

**Tests:** unit for fit scoring (AniList rank, MangaBaka matched, post-filter, blend, no profile), lift clamp and
baseline choice, distinctive order, family threshold (4 no, 5 yes) and rotation, Similar fill trigger (11 yes, 12
no), distinctive MangaBaka tags, overlap ranking, source parsing, For You weights / recall baseline. Browser:
`for-you.e2e.mjs` ("More System" with 14 cards, none in library / read-marked / listed / in Best matches; 10
lookups + 3 searches, 0 on reload), new `similar-fill.e2e.mjs` (4 recs + 14 fill, library titles out, 2 MangaBaka
requests with the right params, 0 on reload), `discover-tags.e2e.mjs` (Best match without taste = MangaBaka order,
with a cached taste the Medicine titles lead; no profile request).

**For Cowork's live check:** acceptance 4 (Male Protagonist out of the top 5) depends on Ethan's list and the pool:
the clamp caps a rare tag's lift at 3, so a tag on most liked titles can stay high on its total. If it does, the
fix is a tuning question for Ethan (lift exponent, or a lower floor), not a bug.

# Brief #13 v2: For You "Best matches" (branch `feat/foryou-best-matches`)

**Shipped as r3429** (2026-10-21).

Off `custom` (r3427). Cowork's audit: of the top 25 of an AniList-recommendation baseline over all 190 liked titles,
11 were missing from For You only because the week's 4 seeds rotate; the Top picks tail had weak titles (Queen's
Revenge: popularity 368, no score). Ethan never scores, so status and progress carry the taste.

**Done:**

- Seeds: the 40 strongest liked titles (`buildTasteProfile().bestSeeds`, `getEntryWeight`: status x progress x
  score x recency, an unscored entry counts as neutral, never 0; dropped never).
- Data (`ForYouService.loadBestEdges`): their recommendations in aliased requests of 8 seeds
  (`TsujiForYouBest`, `recommendations(sort: RATING_DESC, perPage: 10)`), 5 requests a week, alongside the week's 2,
  cached with the week (none on revisits; a failed batch makes the week partial, retried after an hour). Cache keys
  bumped to `foryou:taste:v2` / `foryou:week:v2`.
- Score (`mergeBestMatches`): sum over recommending seeds of rating x seed weight; the list (any status but Planned)
  and the seeds left out; 120 kept per week.
- Row (`ForYouTab`): "Best matches" first, "Best matches from all N titles you read.", up to 30 after the same hide
  rules and filters as For You, each card with "Because you read X, Y" (its 2 strongest contributing seeds). Top
  picks and the weekly seed rows stay below for variety, without what Best matches shows.
- Quality floor (`passesQualityFloor`) for Top picks and Best matches: no score and under 1,000 users needs 2+
  recommending seeds.
  **Fixed after Cowork's r3428 check** (live: 28 Best matches cards with reasons, The World After the Fall, What a
  Bountiful Harvest Demon Lord!, 66,666 Years, Beware the Villainess! and Peerless Refiner in; no read-marked title;
  nothing under the floor):

1. The week was never stored: `TsujiCache` refuses entries over 300,000 characters, and ~270 full AniList media
   (~2 KB each) went past it, so every page load asked AniList again (11, 7, 7 requests). The week is now stored
   compact (`forYou/weekStore.ts`): each title once (Top picks and Best matches share it), content tags as name +
   rank (8), a 160-character synopsis, the lists as ids with their scores; a guard drops the weakest entries if it
   still wouldn't fit (250,000). 120 weekly candidates (was 150) + 120 Best matches: about 120,000 characters. Key
   `foryou:week:v3`.
2. Best matches never shows a library title, started or not (Sword King in a Women's World: Plan to Read, nothing
   read, linked only by its AniList track record). The library index keeps every library title next to the started
   ones (`LibraryIndex.all`); "Hide what I've started" keeps its meaning elsewhere. Manual links (`tsuji_anilistId`
   manga meta) are not in the index: reading every library manga's meta would make that query heavy.

- Unit: best seeds (40, unscored neutral, dropped out), the score sum, the top 2 reasons, the floor, the batch query,
  5 requests for 40 seeds and none on a revisit, a failed batch. Browser (`for-you.e2e.mjs`, 15 checks): Best
  matches before Top picks, its caption, the leader and its reasons, no read-marked / weak / listed title, no
  repeat in the weekly rows, 2 Best matches requests for 10 liked titles; AniList-sized titles: the week is in
  localStorage (about 118,000 characters) and a reload asks AniList nothing; a not-started library title linked
  only by its track record stays out. Week store (`weekStore.test.ts`): a full week fits (the full-media form was
  over 300,000), the round trip, the guard, the whole-library index.

# Brief #12: new-chapter bell v2 (branch `feat/bell-v2`)

**Shipped as r3427** (2026-10-21; Cowork live: the bell equals Glance bell.json, Perks of Being a Villainess Ch 110
and Log into the Future Ch 355-361 · 7 new; 1 series + 1 chapters request per load; debounce: 0 searches while
picking 3 families, 16 after closing).

Off `custom` (r3426). Cowork's audit: the bell's query took the newest 1,500 unread library chapters of 60 days
(69,271 qualify: the 09-24 import plus Reading backlogs), which reached back only 20.7 days, so a series left unread
for about 3 weeks silently vanished; `latestReadChapter` (source order) could be far off (I've Become a True
Villainess: 19 vs 100); Log into the Future (355 waiting when 356-361 arrived) was hidden. Rules now mirror Cowork's
Glance widget (media-actions v7). UI, watermarks, settings dialog and title count unchanged.

**Done:**

- Data (`TSUJI_BELL_SERIES`, `TSUJI_BELL_CHAPTERS`, `bell/useChapterBell.ts`): one request for the watched
  categories (saved ids, else the names ongoing / Completed) with their series (title, cover, inLibrary,
  inLibraryAt, unreadCount, lastReadChapter.lastReadAt, latestFetchedChapter.fetchedAt) plus the category list; then
  every chapter (id, mangaId, number, isRead, fetchedAt, sourceOrder) of the series in the library with something
  unread, 60 series per request, one after another, at most 300 series (the most recently updated). No window, no
  chapter cap. On load and every 10 minutes (skipped while the tab is hidden). The series answer stays outside
  Apollo's normalized cache (it nests series under categories, which Suwayomi's library queries also write; sharing
  it made both refetch each other) and is reused for 10 minutes across remounts; chapters stay in the cache, so
  reading one anywhere still clears its entry.
- Rules (`buildBellEntry`): highest read = the highest read chapter NUMBER; boundary = max(last read, joined the
  library + 1 day), seconds or ms; above the highest read, fetched by the boundary = waiting, after = arrived. Entry
  when at least 1 arrived and at most 2 waiting; numbers = waiting + arrived; a click opens the earliest copy of the
  first number. Watermarks and the first-run cap as before.
- Unit (`chapterBell.test.ts`, 13): boundary (ms / s, join + 1 day), tolerance 0 / 1 / 2 / 3, highest read by number
  (the source-order case), arrivals 30 and 90 days old, numberless chapters, reading clears, the 300-series cap,
  watermarks. Browser (`chapter-bell.e2e.mjs`, 14 checks): Log into the Future "Ch 355-361 · 7 new", a 5-chapter
  backlog and a never-read import hidden, one series + one chapters request per load.

**Also in this build (from Cowork's r3426 check):** while the tag picker is open, the MangaBaka search waits for
800 ms of quiet after the last chip change (at once when the picker closes), so building System + Regression +
Dungeon no longer runs 3 + 12 + 16 = 31 searches against the 30/min limit (`useBakaFeed({ settleMs })`; browser
check: three chips in 198 ms, no intermediate search).

# Brief #11 v2: MangaBaka tags by id, family / OR chips (branch `fix/mangabaka-tag-ids`)

**Shipped as r3426** (2026-10-21; Cowork live: System + Martial Arts 107 cards, 0 dupes, ids only; System + Murim 2;
System alone 347, no repeats; Regression + Martial Arts 18; Isekai + System 198; AniList-only Martial Arts 85 cards
and 0 MangaBaka calls; the cap note, the progress line and the popularity order). CI runs on `feat/**` only, so the
branch went out as `feat/mangabaka-tag-ids`.

Off `custom` (r3421) + `chore/docs-r3421`. Cowork found every MangaBaka tag search returned too little (System +
Martial Arts: 22 on MangaBaka, ~14 cards; ~110 expected): a tag NAME matches only that tag (an ID covers its whole
subtree: Martial Arts by name 1,447, by id 5,904), "System" by name is a substring match, and a name mixed with an
id returns 0. Nothing outside the MangaBaka tag engine changed.

**Done:**

- Ids only (`buildBakaSearch({ tagIds })`): every `tag=` / `tag_not=` is a numeric id (the type makes a name
  impossible); merged AniList chips use their MangaBaka tag's id or family (`resolveChips`). Chip counts stay
  `series_count`, which now matches what the search uses.
- Family chips (`BAKA_FAMILIES` in `tags/baka.ts`): System = 3081 + 1171 (Level System, with 4 subtags) + 1196
  (System Administrator); Regression = 3495 + 2461 + 2147 + 5101 (not Age Regression 748); Dungeon = 500 + 2103.
  A chip holds a set of ids (OR inside, AND across chips): one sub-search per combination (cartesian product, cap
  16; System x Regression = 12), merged (`tags/bakaMerge.ts`) by `popularity.global.current` (parsed now; it is an
  object) for Popular / Best match, `rating` for Score, year for Newest, de-duplicated by MangaBaka id. Each
  sub-search keeps a cursor and fetches its next page only when its buffered rows run out (no repeats, nothing
  skipped, a failed page consumes nothing). Label: the family's summed counts; hover: "System, Level System (+4),
  System Administrator".
- "+ also match" next to a suggestion adds its ids to a selected chip (a menu when several are selected); the chip
  reads "Martial Arts +1". Any split concept works without a code change.
- Suggestions: the family is first ("System · 839"); the single tags stay offered ("System only · 316", System
  Administrator, Level System ...). A family named like an AniList tag (Dungeon) merges with it, so Dungeon alone
  still runs on AniList.
- Cost: one MangaBaka request per sub-search page; up to 4 go out at once (`ParallelQueue`), a 429 pauses them all
  (Retry-After, else 5 s).

**Fixed after Cowork's r3424 check** (live, Ethan's filters: System + Martial Arts 107 cards / 0 dupes; System alone
347, no repeats; Regression + Martial Arts 18; Isekai + System 198; all requests ids only):

1. The cap is no longer silent: combinations are ranked so each chip's first (most popular) ids run first (by the
   sum of member positions), and over 16 a line under the chips reads "Showing 16 of 24 tag combinations. Remove a
   family or a chip to search them all." "+ also match" is disabled (with that reason on hover) when it would go
   past 16.
2. Speed: sub-searches run 4 at a time with a shared 429 back-off (were one per 2.1 s: ~40 s for 3 families), and
   while the first pages come in Discover shows "Searching MangaBaka: n of N tag combinations" with a progress bar
   above the skeletons.
3. Sort: browsing starts on the saved sort (`tsuji_recFilters.sort`, Ethan's POPULARITY) instead of Best match; a
   choice in the combobox still wins for the session. Best match is Discover's re-rank of each page by how strongly
   the AniList details carry the included AniList tags (why Infinite Evolution led System + Martial Arts); Popular
   merges by `popularity.global.current`, as before.

- Unit (`tags.test.ts`, 19; `RequestQueue.test.ts` +2): ids-only URLs, the product and cap, merge order / dedupe / cursors across pages, a failed
  page, score / newest order, popularity object, family suggestions and hover text. Browser (`discover-tags.e2e.mjs`,
  22 checks): a fake MangaBaka with the live semantics (ids cover subtrees, names don't, mixing returns 0); family
  searches, System + Murim / Martial Arts by id (subtags, dedupe), scrolling 144 family titles with no repeats and no
  page fetched twice, "+ also match", numeric tags only; the saved sort, the 16-of-24 note and a disabled
  "+ also match" past the cap (25 checks).

# Follow-up: preview comments start at chapter 1 (branch `feat/preview-comments-ch1`)

Off `custom` (r3419, the bell). **Shipped as r3421** (2026-10-20; Cowork live: The Top Dungeon Farmer, Debut or
Die! and The World After the Fall open on Ch. 1 from Comick, 149 / 42 / 194 comments, one comment request (chap=1)
per preview). The Discover / For You / Similar preview's Comments tab
opens on the first of chapters 1-5 that has comments (else chapter 1; a series without those numbers opens on its
lowest chapter), never the newest: a preview decides whether to start a series, so late comments are spoilers
(`findPreviewChapter` in `comments/chapterNav.ts`, replacing #8's "newest of the last 3"). The chapter picker stays;
the reader's comments stay on the current chapter. Unit test updated; browser check: ch 1 empty, ch 2 opens, chapters
3-8 (the newest has comments) never asked.

# Brief #10: new-chapter bell (branch `feat/chapter-bell`)

**Shipped as r3419** (2026-10-20). Cowork live: "New chapters: 2" (The Investor Who Sees The Future, ongoing, Ch
108-110 · 3 new; God-Level Assassin, I'm the Shadow, ongoing, Ch 147), nothing from Reading; first run wrote only
`tsuji_bellStart` (under 30 entries); a row opened ch 108 (first new), count 2 -> 1 in both browsers; Mark all seen
-> 0; the dialog lists all 8 categories, adding Reading -> 4; one TSUJI_CHAPTER_BELL request per load, no OOM
(965 MiB / 2 GiB).

Off `custom` (r3416) + `chore/docs-r3416`. Replaces Cowork's Discord chapter pings: a bell in the app bar for series
Ethan is caught up on in `ongoing` / `Completed`. One upstream hook: `DefaultNavBar.tsx` (the reader has its own bar,
so no bell there).

**Done:**

- Data (`TSUJI_CHAPTER_BELL`, `bell/useChapterBell.ts`): one request on load and every 10 minutes while mounted
  (skipped while the tab is hidden): unread library chapters fetched in the last 60 days (newest first, at most
  1500; flat `chapters` with a few fields of their series: title, cover, unread count, latest read chapter number,
  categories) plus the category list. Never a series' whole chapter list (the heavy nested query that ran the server
  out of heap). Reading a chapter anywhere updates Apollo's cache, which clears its entry without a request.
- Rules (`bell/chapterBell.ts`): an entry per series in a watched category that is caught up (its unread count equals
  its unread chapters in the window, so no older backlog; something read) with unread chapters numbered above the
  highest read one. Copies of one number are one chapter (brief #4); a new copy of a chapter already read and
  chapters without a number are ignored. Row: cover, title, category chip, "Ch 152" / "Ch 152-154 · 3 new", relative
  time of the newest fetch; newest first. Limits: an old unread extra or pre-#4 duplicate makes a series count as a
  backlog; a series whose new chapters are older than 60 days drops out.
- UI (`bell/components/TsujiChapterBell.tsx`): bell + badge (hidden at 0, 99+), popover on desktop, bottom sheet
  under 600 px. Row = open the first new chapter (earliest copy of the lowest new number) and mark seen; overflow:
  Mark seen, Open series; header: Mark all seen, settings (watched categories, default the ones named ongoing /
  Completed). Page title "(3) ..." while something is unseen.
- Seen (`tsuji_bell_0` .. `tsuji_bell_15`, bucket = mangaId % 16): per-series watermark (highest number seen), only
  rising, merge-on-write against the server's buckets, serialized, 3800-char bucket limit. First run (no
  `tsuji_bellStart`): the newest 30 entries start unseen, older ones are written as seen.
- Unit (8 in `chapterBell.test.ts`) and browser (`chapter-bell.e2e.mjs`, 14 checks; the mock takes per-test root
  handlers now).

# Brief #9: universal tag search on MangaBaka (branch `feat/mangabaka-tags`)

Off `custom` (r3414) + `chore/lint-staged-generated`. Replaces #8's MangaUpdates engine: MU needed the relay, title
matching back to AniList (extra AniList searches, a 429, "Pick Me Up!" ambiguity) and had no popularity sort.
MangaBaka (`api.mangabaka.org`, upstream Mihon's new tracker) answers CORS with `*`, needs no login and carries the
AniList id on every series. Comments / Reviews in the preview unchanged. No upstream file touched.

**Shipped as r3416** (2026-10-20). Cowork live, Ethan's filters: System · 316, first cards 0.58 s; 0 AniList title
searches, one id_in per page, 0 /mangaupdates/ calls; System + Murim 8 on MangaBaka, 2 shown (6 hidden by list /
chapters), Planned badge; Pick Me Up / SSS-Class / Solo Leveling hidden; "Action · 35012" stays on AniList; comments
unchanged. MangaBaka's `rating` is 0-100; `limit=50` (even 100) is accepted.

**Done:**

- Suggestions (`tags/tagKeys.ts`, `useTagSuggestions`): AniList catalog + MangaBaka `GET /v1/tags?q=` (300 ms
  debounce, cached a week), merged by normalized name (AniList "Dungeon" + MangaBaka "Dungeon" = one chip). Label
  "System · 316" (series count), hover: MangaBaka parent path + AniList backing. #8's aliases are gone: MangaBaka's
  hierarchy has System under Game Elements, Level System / Stat System are offered next to it. Adult tags only with
  the Adult filter; empty tags dropped.
- Engine (`tags/baka.ts`, `getSearchEngine`): AniList unless a selected chip has no AniList backing; then
  `GET /v1/series/search`: `tag=` names (AND), `tag_not=` ids, `type=` from the Type filter (comics only without
  one), `content_rating` safe + suggestive, all four with 18+ on, `rating_lower` = min score, `sort_by` Best match /
  Popularity `popularity_asc` (a rank: asc = most popular), Score `score_desc`, Newest `published_year_desc`, 50 a
  page (25 for the session if MangaBaka refuses 50). AniList-only chips ride along as the MangaBaka tag of the same
  name when one exists, else post-filter AniList details (tags rank >= 60). Min chapters stays client side
  (MangaBaka drops series without a count; Discover lets them pass).
- Cards (`useBakaFeed`, `toBakaCards`): render straight from MangaBaka, id = `source.anilist.id` (list hiding, marks,
  Planned badges, library hiding by AniList / MAL id and title), negative id without one (no badge, no comments /
  reviews). AniList details for each loaded page in ONE `Media(id_in)` request (`TsujiBakaDetails`), no title
  searches; MangaBaka's chapter count and rating stay on the card so filters never flip a shown card.
- Etiquette (`tags/bakaService.ts`): search one per 2.1 s after a burst of 3 (limit 30/min), tags one per 0.5 s; 429
  waits Retry-After (else 5 s), two retries; search pages cached an hour (and in memory, in-flight shared), tags a
  week; no token, no custom header (a browser can't set User-Agent and an extra header would need a preflight).
- Removed (MangaUpdates): `tags/muSearch.ts` (queries, parsing, matcher, MU genres, `toMuCards`), `tags/muService.ts`
  (relay calls, match cache `mu:match:v2:*`), `tags/muQueries.ts` (aliased title searches), `tags/useMuFeed.ts`, #8's
  tag aliases, and the export of `getCommentsRelayUrl`. Kept: `passesAniListChips`, `isUnmatchedMedia` (moved to
  `baka.ts`); covers load without crossOrigin unless AniList's CDN (MangaBaka's CDN too).
- Unit (13 in `tags.test.ts`) and browser (`discover-tags.e2e.mjs`, 18 checks, fake MangaBaka, Ethan's filters).

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
  newest chapter with comments (fix 6), with the brief #5.1 picker (chapters from Comick's chapter map). Reviews: AniList's 5
  best-rated (summary, score, helpful count, link).
  **Shipped as r3414** (2026-10-20; Cowork live: first cards 2.5 s, no repeated MU searches, Pick Me Up! -> 159441,
  System + Martial Arts 105 cards, 0 MU CORS errors, comments stepping back 119 -> 117). **Fixed after Cowork's r3410
  check** (MU verified live: the `category` array is AND, `type` is OR, an unknown
  category gives 0; "Martial Arts" is an MU genre, not a category):

1. Speed: MU pages render as soon as MU answers (MU title / cover cards); AniList matching runs behind them, page by
   page in order, 10 titles per request, and cards fill in as batches land (`toMuCards`: a card without a verdict
   shows as its MU card; post-filter and Adult apply once the verdict is in; one card per AniList id). Was ~25 s to
   the first card (the grid waited for all ~127 matches).
2. No repeated MU searches: identical bodies are answered from memory for 15 min, also while in flight, and the
   request outlives an aborted caller (a feed reset with the same selection picks it up); matches are remembered
   per tab too. Cache key now `mu:match:v2:<series_id>`.
3. Matcher: exact-name collisions are tie-broken by the MU type's country (Manhwa KR, Manhua CN, Manga JP), then
   the year within 1; an exact name only from another country is no match. MU "Pick Me Up!" (2022, Manhwa) now
   gets AniList 159441, not Gekka Bijin (synonym "Pick Me Up").
4. AniList chips inside an MU search that are MU genres (fixed list, `MU_GENRES`) go to MU as `genre` /
   `exclude_genre`; only the rest stay a post-filter (`splitAniListChips`). System + Martial Arts + Manhwa = 14 on MU.
5. Covers: only AniList hosts load with `crossOrigin` (MU's CDN sends no CORS headers).
6. Preview comments open on the newest of the last 3 chapters that has comments (Comick's chapter list has no
   count, so each thread is asked, newest first), else the newest.

- Unit (27, one in `chapterNav.test.ts`): tag keys, suggestions (System alias, Dungeon merge, adult, noise, aliases), engine, merged chips on
  AniList, MU queries (OR/AND combinations, cap, adult, types, sort), MU parsing, matching, post-filter, unmatched
  cards, name collisions, MU genres, cards while matches land, commented chapter, Comick-by-AniList (links.al,
  look-alikes refused, MangaDex fallback, cache). Browser (`discover-tags.e2e.mjs`, 19 checks) with a fake MU /
  Comick relay and AniList matching held back to see cards before matches.

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
