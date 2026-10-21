/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the AniList outage fallback (brief #15) on the production build: mocked Suwayomi, AniList blocked
// (route abort), a fake Comick behind the relay and a fake MangaBaka. Discover landing, chips, Similar and For You
// keep working with the note; nothing more goes to AniList; adult Comick titles stay hidden. Then AniList answers
// again and a reload brings everything back.
//
// Usage: pnpm build && node tools/scripts/tsuji/anilist-down.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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

const MANGA_ID = 9;
const SEED_ID = 5000;
const RELAY = 'suwayomi.test:4568';
const DOWN_NOTE = 'AniList is down: showing titles from Comick and MangaBaka.';
/** Library titles: one only by title (a Comick card), one by its AniList id. */
const LIBRARY_TITLE = 'Comick 3';
/** On the list (matched by title, it takes AniList id 5001): hidden. */
const LIST_TITLE = 'Comick 4';
const LIKED = [0, 1, 2];

/** normalizeTitle + titleKey of the app (recs/normalize.ts, seen/myList.ts). */
const titleKey = (title) => {
    const normalized = title
        .normalize('NFKD')
        .replaceAll(/\p{M}/gu, '')
        .toLowerCase()
        .replaceAll(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ')
        .replaceAll(/[^a-z0-9 ]/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();
    let hash = 0x811c9dc5;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};

const LIST_FETCHED_AT = Date.UTC(2026, 9, 20, 12);
const entry = (value) => JSON.stringify({ expiresAt: Date.now() + 10 * 86_400_000, value });

/** What a previous visit left in the cache: the list, its titles, the taste profile. */
const seededCache = () => {
    const listedIds = [...LIKED.map((index) => 1000 + index), 5001];
    return {
        'tsujiCache2:myList:last:v1:ejustice': entry({
            fetchedAt: LIST_FETCHED_AT,
            list: Object.fromEntries(listedIds.map((id) => [String(id), ['COMPLETED', 100]])),
        }),
        'tsujiCache2:myList:titles:v1:ejustice': entry({
            [titleKey(LIST_TITLE)]: 5001,
            ...Object.fromEntries(LIKED.map((index) => [titleKey(`Liked ${index}`), 1000 + index])),
        }),
        'tsujiCache2:foryou:taste:last:v1:ejustice': entry({
            fetchedAt: LIST_FETCHED_AT,
            profile: {
                tags: [{ name: 'Action', rank: 100 }],
                tagStats: [{ name: 'Action', total: 3, titles: 3 }],
                likedCount: 3,
                seedPool: LIKED.map((index) => ({ mediaId: 1000 + index, title: `Liked ${index}`, weight: 1 })),
                bestSeeds: LIKED.map((index) => ({
                    mediaId: 1000 + index,
                    title: `Liked ${index}`,
                    weight: 3 - index,
                })),
                familySeeds: [],
                listedIds,
                entryCount: 3,
            },
        }),
    };
};

const comic = (id, title, overrides = {}) => ({
    id,
    hid: `h${id}`,
    slug: `comic-${id}`,
    title,
    country: id % 2 ? 'kr' : 'cn',
    status: 1,
    last_chapter: 80,
    year: 2020,
    genres: [1],
    content_rating: 'safe',
    bayesian_rating: '8.0',
    user_follow_count: 100_000 - id,
    ...overrides,
});
const relates = (items) => items.map((item, index) => ({ up: 20 - index, down: 0, total: 20 - index, relates: item }));

/** Fake Comick behind the relay: genres, the Discover search, title searches and comic pages. */
const createComick = () => {
    const requests = [];
    const answer = (url) => {
        const path = url.pathname.replace(/^\/comick/, '');
        requests.push(path + url.search);
        if (path === '/genre/') {
            return [{ id: 1, name: 'Action', slug: 'action' }];
        }
        if (path === '/v1.0/search') {
            const query = url.searchParams.get('q');
            if (query === 'Return to Player') {
                return [comic(900, 'Return to Player', { slug: 'return-to-player' })];
            }
            const liked = /^Liked (\d)$/.exec(query ?? '');
            if (liked) {
                return [comic(800 + Number(liked[1]), query, { slug: `liked-${liked[1]}` })];
            }
            if (query) {
                return [];
            }
            // The Discover list: 100 titles; the last 6 are erotica.
            return Array.from({ length: 100 }, (_, index) =>
                comic(index + 1, `Comick ${index + 1}`, index >= 94 ? { content_rating: 'erotica' } : {}),
            );
        }
        if (path === '/comic/return-to-player/') {
            return {
                comic: {
                    links: { al: String(SEED_ID) },
                    recommendations: relates([
                        ...Array.from({ length: 10 }, (_, index) => comic(300 + index, `Rec ${300 + index}`)),
                        comic(3, LIBRARY_TITLE),
                        comic(4, LIST_TITLE),
                        comic(399, 'Rec Adult', { content_rating: 'pornographic' }),
                    ]),
                },
            };
        }
        const liked = /^\/comic\/liked-(\d)\/$/.exec(path);
        if (liked) {
            const index = Number(liked[1]);
            return {
                comic: {
                    links: { al: String(1000 + index) },
                    recommendations: relates([
                        comic(700, 'Pick Shared'),
                        ...Array.from({ length: 5 }, (_, at) => comic(710 + index * 10 + at, `Pick ${index}-${at}`)),
                        // Another liked title: on the list, never picked.
                        comic(800 + ((index + 1) % 3), `Liked ${(index + 1) % 3}`),
                    ]),
                },
            };
        }
        return null;
    };
    return { requests, answer };
};

const bakaTag = (id, count) => ({ id, parent_id: null, series_count: count, weight: 'core', is_spoiler: false });

/** Fake MangaBaka: tag search (nothing for Medicine), the System search, and the Similar fill. */
const answerBaka = (url) => {
    if (url.pathname === '/v1/tags') {
        return { data: [] };
    }
    if (url.pathname === `/v1/source/anilist/${SEED_ID}`) {
        return {
            data: {
                series: [
                    {
                        id: 1,
                        title: 'Return to Player',
                        source: { anilist: { id: SEED_ID } },
                        tags_v2: [bakaTag(11, 60), bakaTag(12, 90), bakaTag(13, 500)],
                    },
                ],
            },
        };
    }
    if (url.pathname === '/v1/series/search') {
        const tags = url.searchParams.getAll('tag');
        const isFill = tags.some((tag) => ['11', '12', '13'].includes(tag));
        const rows = Array.from({ length: 12 }, (_, index) => ({
            id: (isFill ? 50 : 10) + index,
            title: `${isFill ? 'Fill' : 'Baka'} ${index}`,
            type: 'manhwa',
            content_rating: 'safe',
            rating: 70,
            popularity: { global: { current: index + 1 } },
            source: { anilist: { id: (isFill ? 650 : 600) + index } },
            tags_v2: isFill ? [bakaTag(11, 60), bakaTag(12, 90), bakaTag(13, 500)] : [],
        }));
        return { data: rows, pagination: { count: rows.length, next: null } };
    }
    return null;
};

const media = (id, title) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: title, english: title, romaji: null },
    coverImage: { large: null },
    description: 'A test title.',
    averageScore: 75,
    meanScore: null,
    popularity: 20_000 - id,
    favourites: 0,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: { year: 2020, month: 1, day: 1 },
    tags: [],
});

/** AniList once it is back. */
const answerAniList = ({ query }) => {
    const operation = query.match(/query\s+(\w+)/)?.[1];
    switch (operation) {
        case 'TsujiMyList':
            return { MediaListCollection: { lists: [] } };
        case 'TsujiDiscoverPage':
            return {
                Page: {
                    pageInfo: { hasNextPage: false },
                    media: Array.from({ length: 20 }, (_, index) => media(2000 + index, `AniList Title ${index}`)),
                },
            };
        case 'TsujiSimilarSeed':
            return {
                Media: {
                    id: SEED_ID,
                    idMal: null,
                    title: { english: 'Return to Player', romaji: null, userPreferred: 'Return to Player' },
                    synonyms: [],
                    tags: [],
                    recommendations: {
                        // Rec 300 is also one of Comick's: shown once.
                        nodes: [media(3000, 'Rec 300'), media(3001, 'AniList Rec')].map((item) => ({
                            rating: 50,
                            mediaRecommendation: item,
                        })),
                    },
                },
            };
        case 'TsujiProbe':
            return { Media: { id: 1 } };
        default:
            return {};
    }
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

const libraryManga = (id, title, trackRecords = []) => ({
    id,
    title,
    unreadCount: 10,
    chapters: { totalCount: 10 },
    trackRecords: { nodes: trackRecords },
});

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;
    const comick = createComick();
    const aniList = { requests: 0, isDown: true };
    const manga = {
        id: MANGA_ID,
        title: 'Return to Player',
        sourceId: '1',
        inLibrary: true,
        genre: [],
        source: { id: '1', name: 'Local source', displayName: 'Local source' },
        trackRecords: { nodes: [{ id: 1, trackerId: 2, remoteId: String(SEED_ID) }] },
    };
    const server = createMockSuwayomi({
        manga,
        chapters: [],
        pageCount: 0,
        // Ethan's filters: Manhwa + Manhua, 50+ chapters, hide library and list.
        globalMeta: { tsuji_recFilters: JSON.stringify({ types: ['MANHWA', 'MANHUA'], minChapters: 50 }) },
        handlers: {
            'Query.mangas': () => ({
                nodes: [manga, libraryManga(20, LIBRARY_TITLE)],
                totalCount: 2,
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
            }),
        },
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const seeded = seededCache();
    await context.addInitScript((entries) => {
        if (!sessionStorage.getItem('e2e:seeded')) {
            Object.entries(entries).forEach(([key, value]) => localStorage.setItem(key, value));
            sessionStorage.setItem('e2e:seeded', '1');
        }
    }, seeded);
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.host === 'graphql.anilist.co') {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            aniList.requests += 1;
            if (aniList.isDown) {
                return route.abort();
            }
            return route.fulfill({
                status: 200,
                headers: { ...CORS, 'content-type': 'application/json' },
                body: JSON.stringify({ data: answerAniList(request.postDataJSON()) }),
            });
        }
        if (url.host === RELAY && url.pathname.startsWith('/comick/')) {
            const result = comick.answer(url);
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
        if (url.host === 'api.mangabaka.org') {
            const result = answerBaka(url);
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
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const cardTitles = (prefix) =>
        page
            .locator(`button[aria-label^="${prefix}"]`)
            .evaluateAll((buttons) => buttons.map((button) => button.getAttribute('aria-label')));

    // 1. Discover landing with AniList down.
    const startedAt = Date.now();
    await page.goto(`${ORIGIN}/discover`);
    // oxlint-disable-next-line no-await-in-loop
    for (let waited = 0; (await cardTitles('Comick ')).length < 40 && waited < 15_000; waited += 200) {
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(200);
    }
    const landingMs = Date.now() - startedAt;
    const landing = await cardTitles('Comick ');
    const discoverSearch = comick.requests.find((path) => path.startsWith('/v1.0/search?') && !path.includes('q='));
    const searchParams = new URLSearchParams(discoverSearch?.split('?')[1]);
    check(
        label('landing: 40+ Comick cards within 5 s, with the note; filters sent to Comick (kr + cn, 50+ chapters)'),
        landing.length >= 40 &&
            landingMs < 5000 &&
            (await page.getByText(DOWN_NOTE).isVisible()) &&
            searchParams.getAll('country').join() === 'cn,kr' &&
            searchParams.get('minimum') === '50',
        { cards: landing.length, landingMs, discoverSearch },
    );
    check(
        label('landing: no library title, no list title (matched by title), no erotica'),
        !landing.includes(LIBRARY_TITLE) &&
            !landing.includes(LIST_TITLE) &&
            !landing.some((title) => Number(title.split(' ')[1]) > 94),
        landing.filter((title) => [LIBRARY_TITLE, LIST_TITLE].includes(title) || Number(title.split(' ')[1]) > 94),
    );
    await page.getByText(DOWN_NOTE).click();
    check(
        label('the note opens to the last AniList error and the next try'),
        await page.getByText(/AniList's last answer: .+\. Asked again at/).isVisible(),
        {},
    );
    const aniListAfterLanding = aniList.requests;

    // 2. Chips: System (MangaBaka) + Medicine (AniList only, nothing like it on MangaBaka).
    await page.evaluate(() =>
        sessionStorage.setItem(
            'tsuji:discoverSelection',
            JSON.stringify({
                genres: {},
                tags: { Medicine: 'include' },
                baka: {
                    system: {
                        state: 'include',
                        label: 'System',
                        bakaTags: [
                            { id: 3081, name: 'System' },
                            { id: 1171, name: 'Level System' },
                            { id: 1196, name: 'System Administrator' },
                        ],
                    },
                },
            }),
        ),
    );
    await page.reload();
    await page
        .getByRole('button', { name: 'Baka 0' })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    check(
        label('chips: MangaBaka results; the AniList-only chip says it is not available, no error'),
        (await cardTitles('Baka ')).length >= 10 &&
            (await page.getByText('Medicine (not available while AniList is down)').isVisible()) &&
            !(await page.getByText(/Couldn't load/).count()),
        { cards: (await cardTitles('Baka ')).length },
    );
    await page.evaluate(() => sessionStorage.removeItem('tsuji:discoverSelection'));

    // 3. Similar on Return to Player.
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
    await page
        .getByRole('button', { name: 'Rec 300' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1500);
    const similar = [...(await cardTitles('Rec ')), ...(await cardTitles('Fill '))];
    check(
        label('Similar: 12+ cards from Comick + the MangaBaka fill, "via Comick", no library / list / adult title'),
        similar.length >= 12 &&
            (await page.getByText('via Comick').count()) > 0 &&
            !similar.includes('Rec Adult') &&
            !(await cardTitles(LIBRARY_TITLE)).length &&
            !(await cardTitles(LIST_TITLE)).length,
        similar,
    );

    // 4. For You from the cached profile.
    await page.goto(`${ORIGIN}/discover`);
    await page.getByRole('tab', { name: 'For You' }).click();
    await page
        .getByRole('heading', { name: 'Best matches' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    const picks = await cardTitles('Pick ');
    const forYouText = await page.locator('body').innerText();
    check(
        label('For You: Best matches from Comick on the cached list, with the dated note; no liked title back'),
        picks[0] === 'Pick Shared' &&
            picks.length >= 10 &&
            /AniList is down: picks from Comick, based on your list from Oct 20\./.test(forYouText) &&
            !(await cardTitles('Liked ')).length,
        { picks, note: forYouText.match(/AniList is down: picks[^\n]*/)?.[0] },
    );
    check(
        // 3 page loads since the landing (chips, Similar, For You): one probe each, nothing else.
        label('AniList: after the first failures only one probe per page load, none from the features'),
        aniListAfterLanding <= 4 && aniList.requests - aniListAfterLanding <= 3,
        { requests: aniList.requests, afterLanding: aniListAfterLanding },
    );
    const comickPerMinute = comick.requests.length;
    check(label('Comick through the relay: under 120 requests'), comickPerMinute < 120, { comickPerMinute });

    // 5. AniList is back: a reload probes it at once and everything returns.
    aniList.isDown = false;
    await page.goto(`${ORIGIN}/discover`);
    await page.getByRole('tab', { name: 'Discover' }).click();
    await page
        .getByRole('button', { name: 'AniList Title 0' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    check(
        label('back: AniList cards, no note'),
        (await cardTitles('AniList Title ')).length > 0 && !(await page.getByText(DOWN_NOTE).count()),
        { cards: (await cardTitles('AniList Title ')).length },
    );
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
    await page
        .getByRole('button', { name: 'AniList Rec' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1000);
    const merged = await cardTitles('Rec ');
    check(
        label('back: Similar from AniList with the Comick extras merged in, no duplicates'),
        (await cardTitles('AniList Rec')).length === 1 &&
            merged.filter((title) => title === 'Rec 300').length === 1 &&
            merged.length >= 9,
        merged,
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
