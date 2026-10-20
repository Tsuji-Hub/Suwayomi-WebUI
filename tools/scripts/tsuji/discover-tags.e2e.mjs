/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the universal tag search on MangaBaka (brief #9) and the preview's Comments / Reviews tabs (brief
// #8 v2) on the production build: mocked Suwayomi (one started library title), fixture AniList and a fake
// MangaBaka (api.mangabaka.org answered by the test), a fake relay for Comick / MangaDex. Ethan's filters: Manhwa +
// Manhua, at least 50 chapters, 18+ on, hide library and list. Checks one "System" chip, MangaBaka search params,
// popular order, hiding (list, library, read mark, chapters, type), Planned badges, cards without an AniList id,
// one AniList id_in request per page and no AniList searches, no MangaUpdates calls, System + Murim (AND),
// merged chips staying on AniList, no repeated searches, CORS-free covers, comments by links.al on the first of
// chapters 1-5 with comments.
//
// Usage: pnpm build && node tools/scripts/tsuji/discover-tags.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const RELAY = 'http://suwayomi.test:4568';
const BAKA_HOST = 'api.mangabaka.org';
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

/** MangaBaka's tag tree (ids as on the live site where it matters): an id covers its subtags, a name doesn't. */
const BAKA_TAGS = [
    { id: 3081, name: 'System', name_path: 'Settings > Game Elements > System', series_count: 316 },
    { id: 1171, name: 'Level System', name_path: 'Settings > Game Elements > Level System', series_count: 250 },
    {
        id: 13,
        name: 'Stat System',
        name_path: 'Settings > Game Elements > Level System > Stat System',
        series_count: 90,
        parent: 1171,
    },
    {
        id: 14,
        name: 'System Sidekick',
        name_path: 'Settings > Game Elements > Level System > System Sidekick',
        series_count: 0,
        parent: 1171,
    },
    { id: 1196, name: 'System Administrator', name_path: 'Characters > System Administrator', series_count: 273 },
    { id: 500, name: 'Dungeon', name_path: 'Settings > Dungeon', series_count: 586 },
    { id: 2103, name: 'Dungeon Exploring', name_path: 'Theme > Dungeon Exploring', series_count: 146 },
    { id: 40, name: 'Murim', name_path: 'Settings > Murim', series_count: 420 },
    { id: 29, name: 'Martial Arts', name_path: 'Theme > Martial Arts', series_count: 5484 },
    { id: 363, name: 'Cultivation', name_path: 'Theme > Martial Arts > Cultivation', series_count: 363, parent: 29 },
].map((tag) => ({ content_rating: 'safe', is_genre: false, ...tag }));
const tagByName = (name) => BAKA_TAGS.find((tag) => tag.name === name);
/** The tag and every ancestor: what an id search finds a series under. */
const withAncestors = (tag) => (tag ? [tag.id, ...withAncestors(BAKA_TAGS.find(({ id }) => id === tag.parent))] : []);

/** [MangaBaka id, title, AniList id, popularity rank, total chapters, tag names, overrides]. */
const BAKA_SERIES = [
    [1, 'Solo Leveling', 105398, 1, 201, ['System', 'Dungeon']],
    [2, 'Tower of God', 85143, 2, 600, ['System']],
    [3, 'The Greatest Estate Developer', 137280, 3, 180, ['System']],
    [4, 'SSS-Class Revival Hunter', 140000, 4, 120, ['System']],
    [5, 'Pick Me Up', 159441, 5, 140, ['System']],
    [6, "I'm the Max-Level Newbie", 125000, 6, 190, ['System']],
    [7, "The Heavenly Demon Doesn't Want to Level Up", 170001, 7, 60, ['System', 'Murim']],
    [8, 'I Came Back as a Martial Genius', 170002, 8, 70, ['System', 'Murim']],
    [9, 'Master of the Martial Arts Library', 170003, 9, 90, ['System', 'Murim']],
    [10, 'Psychopath in Murim', 170004, 10, 55, ['System', 'Murim']],
    [11, 'Short Murim System', 170005, 11, 20, ['System', 'Murim']],
    [12, 'Ongoing Unknown System', 170006, 12, null, ['System']],
    [13, 'Raw Only System', null, 13, 80, ['System']],
    [14, 'System Manga From Japan', 170008, 14, 100, ['System'], { type: 'manga' }],
    [15, 'Adult System', 170007, 15, 100, ['System'], { content_rating: 'erotica' }],
    // Missed while tags went by name: Level System / System Administrator members, subtags of Martial Arts.
    [16, 'Second Life Ranker', 170010, 16, 150, ['Level System', 'Martial Arts']],
    [17, 'Return to Player', 170011, 17, 150, ['Stat System']],
    [18, 'Lucky Me: I Secretly Cultivated for 1,000 Years', 170012, 18, 120, ['System Administrator', 'Cultivation']],
    // In two of the family's sub-searches: must show once.
    [19, 'Triple Tag System', 170013, 19, 100, ['System', 'Level System', 'Martial Arts']],
    // Enough System-family titles for several pages (50 a page per sub-search).
    ...Array.from({ length: 130 }, (_, index) => [
        100 + index,
        `Filler System ${String(index + 1).padStart(3, '0')}`,
        180_000 + index,
        100 + index,
        100,
        [['System'], ['Level System'], ['System Administrator']][index % 3],
    ]),
].map(([id, title, anilistId, popularity, chapters, tags, overrides = {}]) => ({
    id,
    title,
    titles: [{ language: 'en', title, is_primary: true, traits: ['official'] }],
    cover: { x250: { x1: `https://cdn.mangabaka.org/covers/${id}.jpg` } },
    type: 'manhwa',
    status: 'releasing',
    rating: 80,
    popularity: { global: { current: popularity, previous: popularity } },
    total_chapters: chapters === null ? null : String(chapters),
    content_rating: 'safe',
    year: 2020,
    source: { anilist: { id: anilistId }, my_anime_list: { id: null } },
    tags,
    tagIds: [...new Set(tags.flatMap((name) => withAncestors(tagByName(name))))],
    ...overrides,
}));

/**
 * Fake MangaBaka: tags search, and series search with the verified semantics: `tag=<id>` covers the subtree (AND
 * across repeats), `tag=<name>` only that very tag, a name mixed with an id finds nothing; `tag_not=<id>` subtree.
 */
const answerBaka = (url, requests) => {
    requests.push(`${url.pathname}?${url.searchParams.toString()}`);
    const params = url.searchParams;
    if (url.pathname === '/v1/tags') {
        const query = (params.get('q') ?? '').toLowerCase();
        return {
            status: 200,
            data: BAKA_TAGS.filter(({ name }) => name.toLowerCase().includes(query)).map(
                ({ parent: _parent, ...tag }) => tag,
            ),
        };
    }
    if (url.pathname === '/v1/series/search') {
        const tags = params.getAll('tag');
        const ids = tags.filter((tag) => /^\d+$/.test(tag)).map(Number);
        const names = tags.filter((tag) => !/^\d+$/.test(tag));
        const notIds = params.getAll('tag_not').map(Number);
        const types = params.getAll('type');
        const ratings = params.getAll('content_rating');
        const allowedRatings = ratings.length ? ratings : ['safe', 'suggestive'];
        const ratingLower = Number(params.get('rating_lower') ?? 0);
        const isMixed = ids.length > 0 && names.length > 0;
        const hits = BAKA_SERIES.filter(
            (series) =>
                !isMixed &&
                ids.every((id) => series.tagIds.includes(id)) &&
                names.every((name) => series.tags.includes(name)) &&
                !notIds.some((id) => series.tagIds.includes(id)) &&
                (!types.length || types.includes(series.type)) &&
                allowedRatings.includes(series.content_rating) &&
                series.rating >= ratingLower,
        ).sort((a, b) => a.popularity.global.current - b.popularity.global.current);
        const page = Number(params.get('page') ?? 1);
        const limit = Number(params.get('limit') ?? 50);
        const data = hits.slice((page - 1) * limit, page * limit).map(({ tagIds: _ids, ...series }) => series);
        return {
            status: 200,
            data,
            pagination: {
                count: hits.length,
                page,
                limit,
                next: page * limit < hits.length ? `?page=${page + 1}` : null,
            },
        };
    }
    return null;
};

const media = (id, title, overrides = {}) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: title, english: title, romaji: title },
    coverImage: { large: null },
    description: `${title} synopsis.`,
    averageScore: 75,
    meanScore: null,
    popularity: 10_000,
    favourites: 0,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: { year: 2020, month: 1, day: 1 },
    tags: [],
    genres: ['Action'],
    ...overrides,
});
const ANILIST_BY_ID = Object.fromEntries(
    BAKA_SERIES.filter(({ source }) => source.anilist.id).map(({ title, source }) => [
        source.anilist.id,
        media(source.anilist.id, title),
    ]),
);

/** AniList operations the MangaBaka path may use; anything else (a title search) is a failure. */
const ALLOWED_ANILIST = new Set([
    'TsujiMyList',
    'TsujiTagCatalog',
    'TsujiBakaDetails',
    'TsujiDiscoverPage',
    'TsujiReviews',
]);

/** Fixture AniList: answers by operation name and counts requests per operation. */
const createAniList = () => {
    const counts = {};
    const answer = ({ query, variables = {} }) => {
        const operation = query.match(/query\s+(\w+)/)?.[1] ?? 'unknown';
        counts[operation] = (counts[operation] ?? 0) + 1;
        switch (operation) {
            case 'TsujiMyList':
                return {
                    MediaListCollection: {
                        lists: [
                            {
                                isCustomList: false,
                                entries: [
                                    { mediaId: 105398, status: 'COMPLETED', progress: 200 },
                                    { mediaId: 170002, status: 'PLANNING', progress: 0 },
                                    { mediaId: 170003, status: 'PLANNING', progress: 0 },
                                ],
                            },
                        ],
                    },
                };
            case 'TsujiTagCatalog':
                return {
                    GenreCollection: ['Action', 'Fantasy', 'Hentai'],
                    MediaTagCollection: [
                        { name: 'Dungeon', description: '', category: 'Setting', isAdult: false },
                        { name: 'Martial Arts', description: '', category: 'Theme-Action', isAdult: false },
                    ],
                };
            case 'TsujiBakaDetails':
                return { Page: { media: (variables.ids ?? []).map((id) => ANILIST_BY_ID[id]).filter(Boolean) } };
            case 'TsujiDiscoverPage':
                return { Page: { pageInfo: { hasNextPage: false }, media: [media(200000, 'AniList Dungeon Title')] } };
            case 'TsujiReviews':
                return {
                    Media: {
                        reviews: {
                            nodes: [
                                {
                                    summary: 'A great hunter story.',
                                    score: 85,
                                    rating: 10,
                                    ratingAmount: 12,
                                    siteUrl: 'https://anilist.co/review/1',
                                    user: { name: 'reader1' },
                                },
                            ],
                        },
                    },
                };
            default:
                return {};
        }
    };
    return { counts, answer };
};

const COMICK_SEARCH = {
    'SSS-Class Revival Hunter': [{ id: 9, hid: 'sss', slug: 'sss-class', title: 'SSS-Class Revival Hunter' }],
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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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
    firefox: () =>
        firefox.launch({ firefoxUserPrefs: { 'ui.primaryPointerCapabilities': 6, 'ui.allPointerCapabilities': 6 } }),
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
    const label = (text) => `[${browserName}] ${text}`;
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const server = createMockSuwayomi({
        // A started library title (one chapter read): hidden by "hide what I've started".
        manga: {
            id: 1,
            title: 'Tower of God',
            sourceId: '1',
            inLibrary: true,
            unreadCount: 4,
            chapters: { totalCount: 5 },
            trackRecords: { nodes: [] },
            genre: [],
            source: { id: '1', name: 'Local' },
        },
        chapters: [],
        pageCount: 0,
        globalMeta: {
            tsuji_recFilters: JSON.stringify({
                types: ['MANHWA', 'MANHUA'],
                minChapters: 50,
                showAdult: true,
                hideInLibrary: true,
                hideOnMyList: true,
                sort: 'POPULARITY',
            }),
            // Ethan's "read" mark on Pick Me Up (159441 % 16 = 1).
            tsuji_seen_1: JSON.stringify({ r: [159441], s: [] }),
        },
    });
    const aniList = createAniList();
    const bakaRequests = [];
    const relayRequests = [];

    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.host === 'graphql.anilist.co') {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            return route.fulfill({
                status: 200,
                headers: { ...CORS, 'content-type': 'application/json' },
                body: JSON.stringify({ data: aniList.answer(request.postDataJSON()) }),
            });
        }
        if (url.host === BAKA_HOST) {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            const body = answerBaka(url, bakaRequests);
            return route.fulfill({
                status: body ? 200 : 404,
                headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify(body ?? { status: 404 }),
            });
        }
        if (url.origin === RELAY) {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            relayRequests.push(`${request.method()} ${url.pathname}${url.search}`);
            const json = (body) =>
                route.fulfill({
                    status: body === null ? 404 : 200,
                    headers: { ...CORS, 'content-type': 'application/json' },
                    body: JSON.stringify(body ?? {}),
                });
            if (url.pathname === '/comick/v1.0/search') {
                return json(COMICK_SEARCH[url.searchParams.get('q')] ?? []);
            }
            if (url.pathname === '/comick/comic/sss-class/') {
                return json({ comic: { hid: 'sss', links: { al: '140000' } } });
            }
            if (url.pathname === '/comick/comic/sss/chapters') {
                return json({
                    chapters: [1, 2, 3, 4, 5, 6, 7, 8].map((number) => ({
                        hid: `sss${number}`,
                        chap: String(number),
                        up_count: 1,
                    })),
                });
            }
            // Chapter 1 has no comments yet, chapter 2 has; the newest (a spoiler for a preview) has too.
            const talk = (content) =>
                json({ comments: [{ id: 1, content, up_count: 2, identities: { traits: { username: 'u' } } }] });
            if (url.pathname === '/comick/comment/chapter/sss1') {
                return json({ comments: [] });
            }
            if (url.pathname === '/comick/comment/chapter/sss2') {
                return talk('Chapter 2 talk');
            }
            if (url.pathname === '/comick/comment/chapter/sss8') {
                return talk('Late spoiler talk');
            }
            if (url.pathname === '/mangadex/manga') {
                return json({ data: [] });
            }
            return json(null);
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
    const seriesSearches = () => bakaRequests.filter((request) => request.startsWith('/v1/series/search'));
    const cardTitles = () =>
        page.evaluate(() =>
            [...document.querySelectorAll('button[aria-label]')]
                .map((button) => button.getAttribute('aria-label'))
                .filter(
                    (name) =>
                        !['open drawer', 'Discover settings', 'More actions'].includes(name) &&
                        !name.startsWith('New chapters') &&
                        !name.startsWith('Also match'),
                ),
        );
    const cardText = (title) =>
        page
            .locator(`button[aria-label="${title}"]`)
            .locator('xpath=..')
            .innerText()
            .catch(() => '');

    await page.goto(`${ORIGIN}/discover`);
    await page.getByRole('button', { name: 'Tags & genres' }).click();
    const search = page.getByRole('textbox', { name: 'Search tags' });
    await search.fill('system');
    await page
        .getByRole('button', { name: /^System · 839$/ })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const suggestions = page.getByRole('group', { name: 'Tag suggestions' });
    const chipLabels = await suggestions.locator('.MuiChip-label').allTextContents();
    check(
        label('"system": the System family first (316 + 250 + 273), the single tags listed too'),
        chipLabels[0] === 'System · 839' &&
            chipLabels.includes('System only · 316') &&
            chipLabels.includes('System Administrator · 273') &&
            chipLabels.some((text) => text.startsWith('Level System')) &&
            !chipLabels.some((text) => text.startsWith('System Sidekick')),
        chipLabels,
    );
    check(label('no MangaBaka series search before a chip is picked'), seriesSearches().length === 0, bakaRequests);

    const pickedAt = Date.now();
    await page.getByRole('button', { name: /^System · 839$/ }).click();
    await page
        .getByRole('button', { name: 'The Greatest Estate Developer' })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const firstCardMs = Date.now() - pickedAt;
    check(label('first cards in under 2 s'), firstCardMs < 2000, firstCardMs);
    await page.waitForTimeout(800);
    const titles = await cardTitles();
    check(
        label('Popular order: the most popular System titles not hidden by list, library or marks'),
        JSON.stringify(titles.slice(0, 3)) ===
            JSON.stringify(['The Greatest Estate Developer', 'SSS-Class Revival Hunter', "I'm the Max-Level Newbie"]),
        titles,
    );
    check(
        label('hidden: Completed on AniList, started in the library, read mark, under 50 chapters, a manga'),
        !['Solo Leveling', 'Tower of God', 'Pick Me Up', 'Short Murim System', 'System Manga From Japan'].some(
            (title) => titles.includes(title),
        ),
        titles,
    );
    check(
        label('shown: unknown chapter count, no AniList id (no badge), adult with 18+ on'),
        ['Ongoing Unknown System', 'Raw Only System', 'Adult System'].every((title) => titles.includes(title)) &&
            !(await cardText('Raw Only System')).includes('Planned'),
        titles,
    );
    const sortShown = await page
        .locator('[aria-label="Sort"]')
        .locator('xpath=..')
        .innerText()
        .catch(() => '');
    check(label('browsing starts on the saved sort (Popular), not Best match'), /popular/i.test(sortShown), sortShown);
    // First pages only: by now the next page of a sub-search may have loaded too (infinite scroll).
    const systemSearches = seriesSearches()
        .map((request) => new URLSearchParams(request.split('?')[1]))
        .filter((params) => params.get('page') === '1');
    check(
        label('System family: one id-only search per member (3081, 1171, 1196), Manhwa + Manhua, every rating'),
        JSON.stringify(systemSearches.map((params) => params.getAll('tag')).sort()) ===
            JSON.stringify([['1171'], ['1196'], ['3081']]) &&
            systemSearches.every(
                (params) =>
                    JSON.stringify(params.getAll('type')) === '["manhua","manhwa"]' &&
                    params.getAll('content_rating').length === 4 &&
                    params.get('sort_by') === 'popularity_asc',
            ),
        seriesSearches(),
    );
    check(
        label('the family brings Level System (and its subtag Stat System) and System Administrator titles'),
        ['Second Life Ranker', 'Return to Player', 'Lucky Me: I Secretly Cultivated for 1,000 Years'].every((title) =>
            titles.includes(title),
        ) && titles.filter((title) => title === 'Triple Tag System').length === 1,
        titles.slice(0, 20),
    );
    // The details request queues behind the landing page's AniList calls (shared 30/min budget).
    for (let waited = 0; !aniList.counts.TsujiBakaDetails && waited < 15_000; waited += 250) {
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(250);
    }
    await page.waitForTimeout(500);
    const otherAniList = Object.keys(aniList.counts).filter((operation) => !ALLOWED_ANILIST.has(operation));
    check(
        label('AniList: one id_in details request for the page, no searches; no /mangaupdates/ calls'),
        aniList.counts.TsujiBakaDetails === 1 &&
            !otherAniList.length &&
            !relayRequests.some((request) => request.includes('/mangaupdates/')),
        { counts: aniList.counts, relayRequests },
    );
    const covers = await page
        .locator('img[src*="cdn.mangabaka.org"]')
        .evaluateAll((images) => images.map((image) => image.getAttribute('crossorigin')));
    check(
        label('MangaBaka covers load without crossOrigin'),
        covers.length > 0 && covers.every((value) => value === null),
        covers,
    );

    // System + Murim: AND on MangaBaka.
    await search.fill('murim');
    await page
        .getByRole('button', { name: /^Murim · 420$/ })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    await suggestions.getByRole('button', { name: /^Murim · 420$/ }).click();
    await page
        .getByRole('button', { name: 'The Greatest Estate Developer' })
        .waitFor({ state: 'detached', timeout: 15_000 })
        .catch(() => {});
    await page
        .getByRole('button', { name: 'Psychopath in Murim' })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    await page.waitForTimeout(500);
    const murim = await cardTitles();
    const murimTags = seriesSearches()
        .slice(-3)
        .map((request) => new URLSearchParams(request.split('?')[1]).getAll('tag'));
    check(
        label('System + Murim: Murim (40) with each System member, four titles, Planned badges on the two planned'),
        JSON.stringify([...murimTags].sort()) ===
            JSON.stringify([
                ['40', '1171'],
                ['40', '1196'],
                ['40', '3081'],
            ]) &&
            JSON.stringify([...murim].sort()) ===
                JSON.stringify(
                    [
                        "The Heavenly Demon Doesn't Want to Level Up",
                        'I Came Back as a Martial Genius',
                        'Master of the Martial Arts Library',
                        'Psychopath in Murim',
                    ].sort(),
                ) &&
            (await cardText('I Came Back as a Martial Genius')).includes('Planned') &&
            (await cardText('Master of the Martial Arts Library')).includes('Planned'),
        { murim, murimTags },
    );

    // Back to System alone: answered from the cache, no new search.
    await page.getByRole('button', { name: 'Clear' }).click();
    await search.fill('system');
    const searchesBefore = seriesSearches().length;
    await page.getByRole('button', { name: /^System · 839$/ }).click();
    await page
        .getByRole('button', { name: 'SSS-Class Revival Hunter' })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    check(
        label('picking System again asks MangaBaka nothing (cached an hour)'),
        seriesSearches().length === searchesBefore,
        seriesSearches().length - searchesBefore,
    );

    // Preview: no comments / reviews calls until a tab is opened; then verified by links.al.
    const commentsBefore = relayRequests.length;
    const reviewsBefore = aniList.counts.TsujiReviews ?? 0;
    await page.getByRole('button', { name: 'SSS-Class Revival Hunter' }).click({ button: 'right' });
    const dialog = page.getByRole('dialog');
    await dialog
        .getByRole('tab', { name: 'Comments' })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    await page.waitForTimeout(800);
    check(
        label('opening a preview makes no comments or reviews calls'),
        relayRequests.length === commentsBefore && (aniList.counts.TsujiReviews ?? 0) === reviewsBefore,
        relayRequests.slice(commentsBefore),
    );
    await dialog.getByRole('tab', { name: 'Comments' }).click();
    await dialog
        .getByText('Chapter 2 talk')
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    check(
        label(
            'Comments: the Comick series whose links.al is the AniList id, first of ch 1-5 with comments (no spoilers)',
        ),
        (await dialog
            .getByText('Chapter 2 talk')
            .isVisible()
            .catch(() => false)) &&
            (await dialog
                .getByRole('button', { name: 'Choose chapter' })
                .textContent()
                .catch(() => '')) === 'Ch. 2' &&
            !relayRequests.some((request) => /chapter\/sss[3-8]/.test(request)),
        relayRequests.filter((request) => request.includes('/comick/')),
    );
    await dialog.getByRole('tab', { name: 'Reviews' }).click();
    await dialog
        .getByText('A great hunter story.')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    check(
        label('Reviews: summary and score'),
        (await dialog
            .getByText('A great hunter story.')
            .isVisible()
            .catch(() => false)) && (await dialog.innerText()).includes('85/100'),
        {},
    );
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Raw Only System' }).click({ button: 'right' });
    await dialog.getByRole('tab', { name: 'Comments' }).click();
    check(
        label('a card without an AniList id: "No comments found", no Reviews tab'),
        (await dialog
            .getByText('No comments found')
            .isVisible()
            .catch(() => false)) && (await dialog.getByRole('tab', { name: 'Reviews' }).count()) === 0,
        {},
    );
    await page.keyboard.press('Escape');

    // System alone, scrolled to the end: every family title once, each sub-search page fetched once.
    let lastCount = -1;
    let stableRounds = 0;
    for (let round = 0; round < 40 && stableRounds < 4; round += 1) {
        // oxlint-disable-next-line no-await-in-loop
        const count = (await cardTitles()).length;
        stableRounds = count === lastCount ? stableRounds + 1 : 0;
        lastCount = count;
        // oxlint-disable-next-line no-await-in-loop
        await page.evaluate(() => document.scrollingElement.scrollTo(0, document.scrollingElement.scrollHeight));
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(800);
    }
    const scrolled = await cardTitles();
    const hiddenTitles = ['Solo Leveling', 'Tower of God', 'Pick Me Up', 'Short Murim System'];
    const familyVisible = BAKA_SERIES.filter(
        (series) =>
            series.type === 'manhwa' &&
            [3081, 1171, 1196].some((id) => series.tagIds.includes(id)) &&
            !hiddenTitles.includes(series.title),
    );
    const seriesPages = seriesSearches();
    check(
        label('scrolling System to the end: every family title once, no page asked twice'),
        scrolled.length === familyVisible.length &&
            new Set(scrolled).size === scrolled.length &&
            new Set(seriesPages).size === seriesPages.length &&
            seriesPages.some((request) => request.includes('page=2')),
        { cards: scrolled.length, expected: familyVisible.length, requests: seriesPages.length },
    );

    // System + Martial Arts: the AniList-merged chip searches MangaBaka by id 29, subtags (Cultivation) included.
    await page.evaluate(() => document.scrollingElement.scrollTo(0, 0));
    await search.fill('martial');
    await page
        .getByRole('button', { name: /^Martial Arts · 5484$/ })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    await suggestions.getByRole('button', { name: /^Martial Arts · 5484$/ }).click();
    await page
        .getByRole('button', { name: 'Lucky Me: I Secretly Cultivated for 1,000 Years' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1000);
    const martial = await cardTitles();
    const martialTags = seriesSearches()
        .slice(-3)
        .map((request) => new URLSearchParams(request.split('?')[1]).getAll('tag'));
    check(
        label(
            'System + Martial Arts: 29 with each System member; Level System, System Administrator + Cultivation, once each',
        ),
        JSON.stringify([...martialTags].sort()) ===
            JSON.stringify([
                ['29', '1171'],
                ['29', '1196'],
                ['29', '3081'],
            ]) &&
            JSON.stringify([...martial].sort()) ===
                JSON.stringify(
                    [
                        'Lucky Me: I Secretly Cultivated for 1,000 Years',
                        'Second Life Ranker',
                        'Triple Tag System',
                    ].sort(),
                ),
        { martial, martialTags },
    );
    check(
        label('every MangaBaka series request uses numeric tag ids only'),
        seriesSearches().every((request) =>
            [...new URLSearchParams(request.split('?')[1]).entries()]
                .filter(([key]) => key === 'tag' || key === 'tag_not')
                .every(([, value]) => /^\d+$/.test(value)),
        ),
        seriesSearches().filter((request) => /tag=[^0-9&]/.test(request)),
    );

    // "+ also match": Murim joins the Martial Arts chip, so System + (Martial Arts or Murim).
    await search.fill('murim');
    await page
        .getByRole('button', { name: 'Also match Murim' })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const beforeAlsoMatch = seriesSearches().length;
    await page.getByRole('button', { name: 'Also match Murim' }).click();
    await page.getByRole('menuitem', { name: 'Add to Martial Arts' }).click();
    await page
        .getByRole('button', { name: 'Psychopath in Murim' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1000);
    const either = await cardTitles();
    const selectedChips = await page.locator('.MuiChip-label').allTextContents();
    check(
        label('"+ also match": Martial Arts +1 searches System with Martial Arts or Murim (6 sub-searches)'),
        selectedChips.includes('Martial Arts +1') &&
            // All six combinations were searched before (System + Murim, System + Martial Arts) and are cached an
            // hour, so anything that does go out must be one of them.
            seriesSearches()
                .slice(beforeAlsoMatch)
                .every((request) => /[?&]tag=(29|40)&tag=(1171|1196|3081)&(?!tag=)/.test(request)) &&
            JSON.stringify([...either].sort()) ===
                JSON.stringify(
                    [
                        'Lucky Me: I Secretly Cultivated for 1,000 Years',
                        'Second Life Ranker',
                        'Triple Tag System',
                        "The Heavenly Demon Doesn't Want to Level Up",
                        'I Came Back as a Martial Genius',
                        'Master of the Martial Arts Library',
                        'Psychopath in Murim',
                    ].sort(),
                ),
        {
            either,
            chips: selectedChips.filter((text) => text.startsWith('Martial')),
            requests: seriesSearches()
                .slice(beforeAlsoMatch)
                .map((request) => new URLSearchParams(request.split('?')[1]).getAll('tag')),
        },
    );

    // System + Regression + Dungeon = 3 x 4 x 2 = 24 combinations: the first 16 run, and the page says so.
    await page.getByRole('button', { name: 'Clear' }).click();
    await search.fill('system');
    await page.getByRole('button', { name: /^System · 839$/ }).click();
    await search.fill('regress');
    await suggestions
        .getByRole('button', { name: /^Regression/ })
        .first()
        .click();
    await search.fill('dungeon');
    await suggestions.getByRole('button', { name: /^Dungeon · 732$/ }).click();
    const capNote = page.getByText('Showing 16 of 24 tag combinations. Remove a family or a chip to search them all.');
    await capNote.waitFor({ timeout: 20_000 }).catch(() => {});
    const threeTagSearches = () =>
        seriesSearches().filter(
            (request) =>
                new URLSearchParams(request.split('?')[1]).getAll('tag').length === 3 && request.includes('page=1&'),
        );
    for (let waited = 0; threeTagSearches().length < 16 && waited < 15_000; waited += 250) {
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(250);
    }
    check(
        label('over 16 combinations: a note says 16 of 24 run, the first ids of each chip first'),
        (await capNote.isVisible().catch(() => false)) &&
            threeTagSearches().length === 16 &&
            threeTagSearches().some((request) => /tag=500&tag=3081&tag=3495&/.test(request)) &&
            !threeTagSearches().some((request) => /tag=1196&tag=2103&tag=5101&/.test(request)),
        { searches: threeTagSearches().length },
    );
    await search.fill('level');
    const levelAlsoMatch = page.getByRole('button', { name: 'Also match Level System' });
    await levelAlsoMatch.waitFor({ timeout: 10_000 }).catch(() => {});
    check(
        label('"+ also match" is disabled when it would go past 16 combinations'),
        await levelAlsoMatch.isDisabled().catch(() => false),
        {},
    );

    // AniList-backed chips only (merged Dungeon): AniList search, zero MangaBaka series searches.
    await page.getByRole('button', { name: 'Clear' }).click();
    const bakaBefore = seriesSearches().length;
    await search.fill('dungeon');
    await page
        .getByRole('button', { name: /^Dungeon · 732$/ })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const dungeonChips = (await suggestions.locator('.MuiChip-label').allTextContents()).filter((text) =>
        text.startsWith('Dungeon ·'),
    );
    check(
        label('"Dungeon" is one merged chip (AniList Dungeon + the MangaBaka Dungeon family, 586 + 146)'),
        dungeonChips.length === 1,
        dungeonChips,
    );
    await page.getByRole('button', { name: /^Dungeon · 732$/ }).click();
    await page
        .getByRole('button', { name: 'AniList Dungeon Title' })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    check(
        label('a search whose chips all have AniList backing runs on AniList and makes no MangaBaka search'),
        (await page
            .getByRole('button', { name: 'AniList Dungeon Title' })
            .isVisible()
            .catch(() => false)) && seriesSearches().length === bakaBefore,
        { searches: seriesSearches().length - bakaBefore },
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
