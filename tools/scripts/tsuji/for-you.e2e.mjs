/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of Discover > For You on the production build (build/, or BUILD_DIR): an in-memory Suwayomi
// (mockSuwayomi.mjs), a fixture AniList (graphql.anilist.co answered by the test) and a fake MangaBaka. Checks the
// tab renders the week's picks and seed rows from 3 AniList requests, applies the list badges, builds the weekly
// "More System" row from MangaBaka (brief #14), and serves a reload from the week cache without asking again.
// Brief #18: Best matches show before the week's seeds and recall are in, the row's lookups stay under MangaBaka's
// rate limit (the fake one answers 429 to lookups closer than 1.5 s) with a placeholder meanwhile, and a revisit
// shows the stored row at once.
//
// Usage: pnpm build && node tools/scripts/tsuji/for-you.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const CONTENT_TYPES = {
    '.html': 'text/html',
    '.js': 'text/javascript',
    '.css': 'text/css',
    '.json': 'application/json',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
    '.webmanifest': 'application/manifest+json',
    '.woff2': 'font/woff2',
};

const TASTE_TAGS = [
    {
        name: 'Revenge',
        rank: 90,
        category: 'Theme-Drama',
        isMediaSpoiler: false,
        isGeneralSpoiler: false,
        isAdult: false,
    },
    {
        name: 'Time Skip',
        rank: 70,
        category: 'Theme-Other',
        isMediaSpoiler: false,
        isGeneralSpoiler: false,
        isAdult: false,
    },
    {
        name: 'Chaebol',
        rank: 60,
        category: 'Theme-Other',
        isMediaSpoiler: false,
        isGeneralSpoiler: false,
        isAdult: false,
    },
    {
        name: 'Office',
        rank: 55,
        category: 'Setting-Workplace',
        isMediaSpoiler: false,
        isGeneralSpoiler: false,
        isAdult: false,
    },
];
const LIST_SIZE = 10;
const PLANNED_ID = 50;
/** Best matches fixture: recommended by every liked title, a weak one-seed title, a read-marked one. */
const BEST_ID = 800;
const WEAK_ID = 900;
const READ_MARK_ID = 805;
/** In the library (Plan to Read, nothing read), matched only through its AniList track record. */
const LIBRARY_ID = 806;
/** Liked titles MangaBaka files under System (5 needed for the row), and the System sub-searches' AniList ids. */
const SYSTEM_LIKED = [1000, 1001, 1002, 1003, 1004, 1005];
const SYSTEM_IDS = Array.from({ length: 14 }, (_, index) => 3000 + index);
/** AniList-sized titles: a long synopsis and 20 tags, as the real answers (the week must still fit the cache). */
const EXTRA_TAGS = Array.from({ length: 16 }, (_, index) => ({
    name: `Extra Tag ${index}`,
    rank: 50 - index,
    category: 'Theme-Other',
    isMediaSpoiler: false,
    isGeneralSpoiler: false,
    isAdult: false,
}));

const media = (id, overrides = {}) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: `Pick ${id}`, english: `Pick ${id}`, romaji: null },
    coverImage: { large: null },
    description: `A test title with a long synopsis. `.repeat(40),
    averageScore: 70 + (id % 20),
    meanScore: null,
    popularity: 5000 + id * 10,
    favourites: 0,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: { year: 2020, month: 1, day: 1 },
    tags: [...TASTE_TAGS.slice(id % 3), ...EXTRA_TAGS],
    ...overrides,
});

/** Fixture AniList: answers by operation name and counts requests per operation. */
const createAniList = () => {
    const counts = {};
    const answer = ({ query, variables = {} }) => {
        const operation = query.match(/query\s+(\w+)/)?.[1] ?? 'unknown';
        counts[operation] = (counts[operation] ?? 0) + 1;
        if (operation.startsWith('TsujiForYou') || operation === 'TsujiTasteList') {
            counts.weekLastAt = Date.now();
        }
        switch (operation) {
            case 'TsujiMyList':
                return {
                    MediaListCollection: {
                        lists: [
                            {
                                isCustomList: false,
                                entries: [
                                    ...Array.from({ length: LIST_SIZE }, (_, index) => ({
                                        mediaId: 1000 + index,
                                        status: 'COMPLETED',
                                        progress: 100,
                                    })),
                                    { mediaId: PLANNED_ID, status: 'PLANNING', progress: 0 },
                                ],
                            },
                        ],
                    },
                };
            case 'TsujiTasteList':
                return {
                    MediaListCollection: {
                        lists: [
                            {
                                isCustomList: false,
                                entries: Array.from({ length: LIST_SIZE }, (_, index) => ({
                                    mediaId: 1000 + index,
                                    status: 'COMPLETED',
                                    progress: 100,
                                    score: 95 - index * 3,
                                    updatedAt: Math.floor(Date.now() / 1000) - index * 86_400,
                                    media: {
                                        title: {
                                            english: `Liked ${index}`,
                                            userPreferred: `Liked ${index}`,
                                            romaji: null,
                                        },
                                        tags: TASTE_TAGS,
                                    },
                                })),
                            },
                        ],
                    },
                };
            case 'TsujiForYouSeeds':
                return Object.fromEntries(
                    Object.entries(variables).map(([key, id], seedIndex) => [
                        `s${key.slice(2)}`,
                        {
                            id,
                            recommendations: {
                                nodes: [
                                    // Shared by every seed: should lead the top picks.
                                    { rating: 60, mediaRecommendation: media(1) },
                                    ...Array.from({ length: 5 }, (_, index) => ({
                                        rating: 40 - index * 5,
                                        mediaRecommendation: media(100 + seedIndex * 10 + index),
                                    })),
                                    // Planned on the list: shown with its badge while "Also hide Planned" is off.
                                    ...(seedIndex === 0
                                        ? [{ rating: 45, mediaRecommendation: media(PLANNED_ID) }]
                                        : []),
                                    // On the list already: never recommended back.
                                    { rating: 90, mediaRecommendation: media(1003) },
                                ],
                            },
                        },
                    ]),
                );
            case 'TsujiForYouBest':
                return Object.fromEntries(
                    Object.entries(variables).map(([key, id]) => [
                        `s${key.slice(2)}`,
                        {
                            id,
                            recommendations: {
                                nodes: [
                                    { rating: 40, mediaRecommendation: media(BEST_ID) },
                                    { rating: 30, mediaRecommendation: media(PLANNED_ID) },
                                    { rating: 25, mediaRecommendation: media(READ_MARK_ID) },
                                    // Also in this week's first seed row: shown once, in Best matches.
                                    { rating: 20, mediaRecommendation: media(100) },
                                    // No score, 368 users, one seed: below the quality floor.
                                    ...(id === 1000
                                        ? [
                                              {
                                                  rating: 90,
                                                  mediaRecommendation: media(WEAK_ID, {
                                                      averageScore: null,
                                                      popularity: 368,
                                                  }),
                                              },
                                          ]
                                        : []),
                                    { rating: 90, mediaRecommendation: media(1003) },
                                    { rating: 35, mediaRecommendation: media(LIBRARY_ID) },
                                    // Ten more of its own per seed: a full-size week.
                                    ...Array.from({ length: 10 }, (_, index) => ({
                                        rating: 15 - index,
                                        mediaRecommendation: media(10_000 + Number(id) * 10 + index),
                                    })),
                                ],
                            },
                        },
                    ]),
                );
            case 'TsujiForYouRecall':
                return {
                    core: { media: [media(PLANNED_ID), media(51), media(52)] },
                    rotating: { media: [media(53), media(54)] },
                };
            case 'TsujiBakaDetails':
                return { Page: { media: (variables.ids ?? []).map((id) => media(id)) } };
            case 'TsujiDiscoverPage':
                return { Page: { pageInfo: { hasNextPage: false }, media: [] } };
            case 'TsujiTagCatalog':
                return { MediaTagCollection: [], GenreCollection: [] };
            default:
                return {};
        }
    };
    return { counts, answer };
};

const bakaSeries = (id, anilistId, popularity, tags = []) => ({
    id,
    title: `Baka ${id}`,
    type: 'manhwa',
    status: 'releasing',
    rating: 80,
    popularity: { global: { current: popularity } },
    source: { anilist: { id: anilistId } },
    tags_v2: tags.map((tagId) => ({ id: tagId, parent_id: null, series_count: 900, weight: 'defining' })),
});

/** How late the week's seeds and recall answer on the first visit. */
const SLOW_WEEK_MS = 4000;
/** Lookups closer together than this get a 429 (MangaBaka's limit, brief #18). */
const BAKA_MIN_GAP_MS = 1500;

/** Fake MangaBaka: the source lookup and the search, counted per path. */
const createBaka = () => {
    const counts = { source: 0, search: 0, firstAt: 0, limited: 0, lastAt: 0 };
    const answer = (url) => {
        const sourceMatch = url.pathname.match(/^\/v1\/source\/anilist\/(\d+)$/);
        if (sourceMatch) {
            const now = Date.now();
            if (counts.lastAt && now - counts.lastAt < BAKA_MIN_GAP_MS) {
                counts.limited += 1;
                return { status: 429 };
            }
            counts.lastAt = now;
            counts.source += 1;
            counts.firstAt ||= now;
            const id = Number(sourceMatch[1]);
            const tags = SYSTEM_LIKED.includes(id) ? [3081] : [77];
            return { status: 200, data: { source_response: null, series: [bakaSeries(id + 50_000, id, 10, tags)] } };
        }
        if (url.pathname === '/v1/series/search') {
            counts.search += 1;
            const tag = url.searchParams.get('tag');
            const page = Number(url.searchParams.get('page') ?? 1);
            // System: page 1 has 6 titles that show and 4 that don't (only 6 of the 10 wanted), page 2 the rest.
            const pages = [
                [
                    ...SYSTEM_IDS.slice(0, 6).map((id, index) => bakaSeries(id, id, index + 1, [3081])),
                    // Already in Best matches, in the library, read-marked, and on the list.
                    ...[BEST_ID, LIBRARY_ID, READ_MARK_ID, 1003].map((id, index) =>
                        bakaSeries(id + 70_000, id, 100 + index, [3081]),
                    ),
                ],
                SYSTEM_IDS.slice(6).map((id, index) => bakaSeries(id, id, index + 7, [3081])),
            ];
            const rows = tag === '3081' ? (pages[page - 1] ?? []) : [];
            return {
                data: rows,
                pagination: { count: rows.length, next: tag === '3081' && page < 2 ? '?page=2' : null },
            };
        }
        return null;
    };
    return { counts, answer };
};

const serveFile = (pathname) => {
    const file = join(BUILD_DIR, pathname);
    const isAsset = pathname !== '/' && existsSync(file) && !pathname.endsWith('/');
    const path = isAsset ? file : join(BUILD_DIR, 'index.html');
    return {
        status: 200,
        contentType: CONTENT_TYPES[extname(path)] ?? 'application/octet-stream',
        body: readFileSync(path),
    };
};

const CORS = {
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, accept',
    'access-control-allow-methods': 'POST, OPTIONS',
};

const launchers = {
    chrome: () => {
        const candidates = [process.env.CHROMIUM_PATH, '/opt/pw-browsers/chromium', undefined].filter((p) => p !== '');
        return candidates.reduce(
            (attempt, executablePath) =>
                attempt.catch(() =>
                    executablePath === undefined
                        ? chromium.launch({ channel: 'chrome' })
                        : chromium.launch({ executablePath }),
                ),
            Promise.reject(new Error('no browser')),
        );
    },
    firefox: () => firefox.launch(),
};

const failures = [];
const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(detail)}`);
    if (!ok) {
        failures.push(label);
    }
};

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const server = createMockSuwayomi({
        manga: {
            id: 1,
            // Another title than AniList's, nothing read: only its AniList track record links it.
            title: 'Sword King Library Copy',
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local' },
            unreadCount: 40,
            chapters: { totalCount: 40 },
            trackRecords: { nodes: [{ id: 1, trackerId: 2, remoteId: String(LIBRARY_ID) }] },
        },
        chapters: [],
        pageCount: 0,
        // A read mark on a Best matches title (805 % 16 = 5).
        globalMeta: { tsuji_seen_5: JSON.stringify({ r: [READ_MARK_ID], s: [] }) },
    });
    const aniList = createAniList();
    const baka = createBaka();
    const pageErrors = [];
    let slowWeek = true;

    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.host === 'graphql.anilist.co') {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            const body = request.postDataJSON();
            // The week's seeds and recall answer late the first time: Best matches must not wait for them.
            const operation = body.query.match(/query\s+(\w+)/)?.[1];
            if (slowWeek && (operation === 'TsujiForYouSeeds' || operation === 'TsujiForYouRecall')) {
                await new Promise((done) => {
                    setTimeout(done, SLOW_WEEK_MS);
                });
            }
            return route.fulfill({
                status: 200,
                headers: { ...CORS, 'content-type': 'application/json' },
                body: JSON.stringify({ data: aniList.answer(body) }),
            });
        }
        if (url.host === 'api.mangabaka.org') {
            const result = baka.answer(url);
            if (result?.status === 429) {
                return route.fulfill({ status: 429, headers: CORS, body: '' });
            }
            return route.fulfill(
                result
                    ? {
                          status: 200,
                          headers: { ...CORS, 'content-type': 'application/json' },
                          body: JSON.stringify(result),
                      }
                    : { status: 404, headers: CORS, body: '' },
            );
        }
        if (url.origin !== ORIGIN) {
            return route.abort();
        }
        if (url.pathname.startsWith('/api/graphql')) {
            const result = await server.handle(request.postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
        }
        if (url.pathname.startsWith('/api/')) {
            return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill(serveFile(url.pathname));
    });
    await context.routeWebSocket(/.*/, (ws) => ws.close());

    const page = await context.newPage();
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const label = (text) => `[${browserName}] ${text}`;

    await page.goto(`${ORIGIN}/discover`);
    await page.getByRole('tab', { name: 'For You' }).click();
    const bestHeading = page.getByRole('heading', { name: 'Best matches' });
    await bestHeading.waitFor({ timeout: 20_000 }).catch(() => {});
    const topPicks = page.getByRole('heading', { name: 'Top picks' });
    check(
        label('Best matches show while the seeds and recall are still out; Top picks follow'),
        (await bestHeading.isVisible()) &&
            !(await topPicks.isVisible()) &&
            (await page.locator('[aria-busy="true"]').count()) > 0,
        aniList.counts,
    );
    await topPicks.waitFor({ timeout: 20_000 }).catch(() => {});
    slowWeek = false;

    check(label('top picks render'), await topPicks.isVisible(), {});
    const topPickCount = await page
        .locator('h2', { hasText: /^Top picks$/ })
        .locator('xpath=following-sibling::div[1]')
        .locator('[aria-label^="Pick "]')
        .count();
    check(label('Top picks: 10+ cards'), topPickCount >= 10, { topPickCount });
    const bodyText = await page.locator('body').innerText();
    const seedRows = await page.getByRole('heading', { name: /^Because you read/ }).count();
    check(label('one row per seed ("Because you read ...")'), seedRows === 4, { seedRows });
    check(
        label('week caption'),
        /Picks for the week of .+ from 10 titles on ejustice's AniList\. New picks every Monday\./.test(bodyText),
        {
            caption: bodyText.match(/Picks for the week[^\n]*/)?.[0],
        },
    );
    check(
        label('taste chips from the list'),
        ['Revenge', 'Time Skip', 'Chaebol'].every((name) => bodyText.includes(name)),
        {},
    );
    check(
        label('the title every seed recommends leads the top picks'),
        // Pick 100 sits in Best matches above; inside Top picks, Pick 1 leads the weekly seeds' titles.
        bodyText.indexOf('Pick 1\n', bodyText.indexOf('Top picks')) <
            bodyText.indexOf('Pick 101', bodyText.indexOf('Top picks')),
        {},
    );
    check(label('a title already on the list is never recommended'), !bodyText.includes('Pick 1003'), {});
    check(
        label('planned title shown with its badge (hide Planned is off by default)'),
        bodyText.includes(`Pick ${PLANNED_ID}`) && bodyText.includes('Planned'),
        {},
    );
    const headings = await page.getByRole('heading', { level: 2 }).allTextContents();
    check(
        label('Best matches first, then Top picks; "from all 10 titles you read"'),
        headings[0] === 'Best matches' &&
            headings[1] === 'Top picks' &&
            bodyText.includes('Best matches from all 10 titles you read.'),
        headings.slice(0, 3),
    );
    check(
        label('the title every liked title recommends leads Best matches, with its top 2 seeds'),
        bodyText.indexOf(`Pick ${BEST_ID}\n`) > -1 &&
            bodyText.indexOf(`Pick ${BEST_ID}\n`) < bodyText.indexOf('Top picks') &&
            bodyText.includes('Because you read Liked 0, Liked 1'),
        {},
    );
    check(
        label(
            'Best matches: no read-marked title, nothing below the quality floor, none on the list or in the library',
        ),
        !bodyText.includes(`Pick ${READ_MARK_ID}`) &&
            !bodyText.includes(`Pick ${WEAK_ID}`) &&
            !bodyText.includes(`Pick ${LIBRARY_ID}`) &&
            !bodyText.includes('Pick 1003'),
        {
            readMark: bodyText.includes(`Pick ${READ_MARK_ID}`),
            weak: bodyText.includes(`Pick ${WEAK_ID}`),
            library: bodyText.includes(`Pick ${LIBRARY_ID}`),
            listed: bodyText.includes('Pick 1003'),
        },
    );
    check(
        label('a title in Best matches is not repeated in the weekly rows'),
        bodyText.split('Pick 100\n').length - 1 === 1,
        { count: bodyText.split('Pick 100\n').length - 1 },
    );
    check(
        label('AniList for the week: list, seeds, recall, and 2 Best matches requests (10 liked titles, 8 a request)'),
        aniList.counts.TsujiTasteList === 1 &&
            aniList.counts.TsujiForYouSeeds === 1 &&
            aniList.counts.TsujiForYouRecall === 1 &&
            aniList.counts.TsujiForYouBest === 2,
        aniList.counts,
    );

    // "More System" (brief #14): 6 of the 10 liked titles carry System on MangaBaka.
    check(
        label('a placeholder while the row is found'),
        await page.getByText('Finding more like your favourites…').isVisible(),
        {},
    );
    const familyRow = page.getByRole('group', { name: 'More System' });
    // 10 lookups one per 2.1 s.
    await familyRow.waitFor({ timeout: 45_000 }).catch(() => {});
    const familyTitles = await familyRow
        .locator('[aria-label^="Pick "]')
        .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));
    const rowsText = await page.locator('body').innerText();
    check(
        label('one "More System" row with 10+ cards: none in the library, read-marked, on the list or shown above'),
        familyTitles.length >= 10 &&
            [BEST_ID, LIBRARY_ID, READ_MARK_ID, 1003].every((id) => !familyTitles.includes(`Pick ${id}`)) &&
            rowsText.split(`Pick ${BEST_ID}\n`).length - 1 === 1 &&
            (await page.getByRole('heading', { name: /^More / }).count()) === 1,
        familyTitles,
    );
    check(
        label('the row is built after the week: its first lookup comes after the last For You AniList request'),
        baka.counts.firstAt > aniList.counts.weekLastAt,
        { firstLookup: baka.counts.firstAt, weekLast: aniList.counts.weekLastAt },
    );
    check(
        label(
            'MangaBaka for the row: one lookup per liked title, under its rate limit (no 429), one search per System tag, a 2nd page for 10+ cards',
        ),
        baka.counts.source === LIST_SIZE && baka.counts.limited === 0 && baka.counts.search === 4,
        baka.counts,
    );
    const familyStored = await page.evaluate(() =>
        Object.keys(localStorage).filter((key) => key.includes('foryou:family:v2:ejustice')),
    );
    check(label('the row is stored for the week'), familyStored.length === 1, familyStored);

    const stored = await page.evaluate(() =>
        Object.keys(localStorage)
            .filter((key) => key.includes('foryou:week:'))
            .map((key) => [key, localStorage.getItem(key).length]),
    );
    check(
        label('the week (with Best matches) is stored in localStorage, under the cache limit'),
        stored.length === 1 && stored[0][0].includes('foryou:week:v6:ejustice') && stored[0][1] < 300_000,
        stored,
    );

    // Reload: the tab is remembered for the session and the week comes from the cache.
    await page.reload();
    await page
        .getByRole('heading', { name: 'Top picks' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page
        .getByRole('group', { name: 'More System' })
        .waitFor({ timeout: 1500 })
        .catch(() => {});
    check(
        label('reload: the row again at once (within 1.5 s of the cards), 0 MangaBaka requests'),
        (await page.getByRole('group', { name: 'More System' }).isVisible()) &&
            baka.counts.source === LIST_SIZE &&
            baka.counts.search === 4,
        baka.counts,
    );
    check(
        label('reload: For You again, from the stored week (0 recommendation requests)'),
        (await page.getByRole('heading', { name: 'Top picks' }).isVisible()) &&
            aniList.counts.TsujiForYouSeeds === 1 &&
            aniList.counts.TsujiForYouRecall === 1 &&
            aniList.counts.TsujiForYouBest === 2 &&
            aniList.counts.TsujiTasteList === 1,
        aniList.counts,
    );

    // Refresh: refetches the list and the week.
    await page.getByRole('button', { name: 'Refresh' }).click();
    // Best matches go first in the queue now (brief #18): the seeds follow a few seconds later.
    for (let waited = 0; waited < 15_000 && aniList.counts.TsujiForYouSeeds < 2; waited += 250) {
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(250);
    }
    check(
        label('Refresh refetches list and week'),
        aniList.counts.TsujiTasteList === 2 && aniList.counts.TsujiForYouSeeds === 2,
        aniList.counts,
    );

    check(label('no page errors'), pageErrors.length === 0, pageErrors);
    await browser.close();
};

const run = async () => {
    const browserNames = (process.env.E2E_BROWSERS ?? 'chrome').split(',').map((name) => name.trim());
    for (const browserName of browserNames) {
        // oxlint-disable-next-line no-await-in-loop
        await runBrowser(browserName);
    }

    if (failures.length) {
        console.log(`\n${failures.length} check(s) failed`);
        process.exit(1);
    }
    console.log('\nall checks passed');
};

run().catch((error) => {
    console.error(error);
    process.exit(1);
});
