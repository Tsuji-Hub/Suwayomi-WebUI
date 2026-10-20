/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the universal tag search and the preview's Comments / Reviews tabs (brief #8 v2) on the production
// build: mocked Suwayomi, fixture AniList (graphql.anilist.co answered by the test), and a fake relay serving
// MangaUpdates (/mangaupdates/v1/categories/search, /v1/series/search), Comick and MangaDex. Checks one "System"
// chip, the MU search (categories OR inside a chip, AND across chips, Manhwa, adult genres excluded), cards before
// matches, matching back to AniList (list hiding, Planned badge, isAdult dropped, unmatched cards, colliding names),
// MU covers without CORS, the merged "Dungeon" chip, System + an AniList tag that MU knows as a genre, no repeated
// MU searches, zero MU calls for AniList-only searches, and comments resolved by links.al, lazily, on the newest
// chapter with comments.
//
// Usage: pnpm build && node tools/scripts/tsuji/discover-tags.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const RELAY = 'http://suwayomi.test:4568';
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

const TAG = (name, rank) => ({
    name,
    rank,
    category: 'Theme',
    isMediaSpoiler: false,
    isGeneralSpoiler: false,
    isAdult: false,
});
const media = (id, title, overrides = {}) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: title, english: title, romaji: title, native: null },
    synonyms: [],
    coverImage: { large: null },
    description: `${title} synopsis.`,
    averageScore: 80,
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

// AniList side: the search hits for each MU title. "Pick Me Up!" collides with an older Japanese title's synonym,
// listed first, as on AniList.
const ANILIST_BY_TITLE = {
    'Solo Leveling': [media(105398, 'Solo Leveling', { startDate: { year: 2018, month: 3, day: 4 } })],
    'SSS-Class Revival Hunter': [media(140000, 'SSS-Class Revival Hunter')],
    'Pick Me Up!': [
        media(94792, 'Gekka Bijin', {
            countryOfOrigin: 'JP',
            startDate: { year: 2008, month: 1, day: 1 },
            synonyms: ['Pick Me Up'],
        }),
        media(150000, 'Pick Me Up!', { startDate: { year: 2022, month: 1, day: 1 } }),
    ],
    'Log-In Murim': [media(160000, 'Log-In Murim', { tags: [TAG('Martial Arts', 80)] })],
    'Grown-Up Match': [media(170000, 'Grown-Up Match', { isAdult: true })],
};
const ANILIST_BY_ID = Object.fromEntries(
    Object.values(ANILIST_BY_TITLE).flatMap((hits) => hits.map((each) => [each.id, each])),
);

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
                                    { mediaId: 150000, status: 'PLANNING', progress: 0 },
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
            case 'TsujiMuMatch':
                return Object.fromEntries(
                    Object.entries(variables).map(([key, title]) => [
                        `m${key.slice(1)}`,
                        { media: ANILIST_BY_TITLE[title] ?? [] },
                    ]),
                );
            case 'TsujiMuById':
                return { Page: { media: (variables.ids ?? []).map((id) => ANILIST_BY_ID[id]).filter(Boolean) } };
            case 'TsujiDiscoverPage':
                return {
                    Page: {
                        pageInfo: { hasNextPage: false },
                        media: [media(200000, 'AniList Dungeon Title', { tags: [TAG('Dungeon', 90)] })],
                    },
                };
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

const MU_CATEGORIES = [
    { category: 'System', usage: 602 },
    { category: 'Level System', usage: 427 },
    { category: 'Stat System', usage: 46 },
    { category: 'System Admin', usage: 3 },
    { category: 'Dungeon/s', usage: 586 },
];

const muRecord = (seriesId, title, categories, { genres = [], type = 'Manhwa', year = 2020 } = {}) => ({
    seriesId,
    categories,
    genres,
    record: {
        series_id: seriesId,
        title,
        url: `https://www.mangaupdates.com/series/${seriesId}`,
        image: { url: { original: `https://cdn.mangaupdates.com/image/i${seriesId}.jpg`, thumb: null } },
        type,
        year: String(year),
        bayesian_rating: 8,
    },
});

const MU_SERIES = [
    muRecord(1, 'Solo Leveling', ['System', 'Level System', 'Dungeon/s'], { year: 2018 }),
    muRecord(2, 'SSS-Class Revival Hunter', ['System', 'Regression']),
    muRecord(3, 'Pick Me Up!', ['Level System', 'Dungeon/s'], { year: 2022 }),
    muRecord(4, 'Log-In Murim', ['Stat System'], { genres: ['Martial Arts'] }),
    muRecord(5, 'Sextopwatch', ['System'], { genres: ['Adult', 'Smut'] }),
    muRecord(6, 'Grown-Up Match', ['System']),
    muRecord(7, 'Raw Only Title', ['System']),
    muRecord(8, 'System Manga From Japan', ['System'], { type: 'Manga' }),
];

/** Fake MangaUpdates behind the relay: categories search, and series search honouring the documented filters. */
const answerMu = (path, body, requests) => {
    requests.push({ path, body });
    if (path === '/v1/categories/search') {
        const search = (body.search ?? '').toLowerCase();
        return {
            total_hits: 0,
            results: MU_CATEGORIES.filter(({ category }) => category.toLowerCase().includes(search)).map((record) => ({
                record,
            })),
        };
    }
    if (path === '/v1/series/search') {
        const hits = MU_SERIES.filter(
            ({ categories, genres, record }) =>
                (body.category ?? []).every((category) => categories.includes(category)) &&
                (body.genre ?? []).every((genre) => genres.includes(genre)) &&
                !(body.exclude_category ?? []).some((category) => categories.includes(category)) &&
                !(body.exclude_genre ?? []).some((genre) => genres.includes(genre)) &&
                (!body.type || body.type.includes(record.type)),
        );
        return {
            total_hits: hits.length,
            page: body.page,
            per_page: body.perpage,
            results: hits.map(({ record }) => ({ record })),
        };
    }
    return null;
};

const COMICK_SEARCH = {
    'SSS-Class Revival Hunter': [{ id: 9, hid: 'sss', slug: 'sss-class', title: 'SSS-Class Revival Hunter' }],
    'Log-In Murim': [{ id: 10, hid: 'other', slug: 'other', title: 'Log-In Murim', links: { al: '1' } }],
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
        manga: {
            id: 1,
            title: 'Unused',
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local' },
        },
        chapters: [],
        pageCount: 0,
        // Type = Manhwa, as in the acceptance check.
        globalMeta: { tsuji_recFilters: JSON.stringify({ types: ['MANHWA'] }) },
    });
    const aniList = createAniList();
    // AniList matching is held until the test lets it go, to see MU cards before any match.
    let releaseMatches;
    const matchGate = new Promise((resolveGate) => {
        releaseMatches = resolveGate;
    });
    const muRequests = [];
    const relayRequests = [];

    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.host === 'graphql.anilist.co') {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            const body = request.postDataJSON();
            if (/query\s+TsujiMuMatch/.test(body.query)) {
                await matchGate;
            }
            return route
                .fulfill({
                    status: 200,
                    headers: { ...CORS, 'content-type': 'application/json' },
                    body: JSON.stringify({ data: aniList.answer(body) }),
                })
                .catch(() => {});
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
            if (url.pathname.startsWith('/mangaupdates/')) {
                if (request.method() !== 'POST') {
                    return route.fulfill({ status: 405, headers: CORS, body: '' });
                }
                return json(answerMu(url.pathname.replace('/mangaupdates', ''), request.postDataJSON(), muRequests));
            }
            if (url.pathname === '/comick/v1.0/search') {
                return json(COMICK_SEARCH[url.searchParams.get('q')] ?? []);
            }
            if (url.pathname === '/comick/comic/sss-class/') {
                return json({ comic: { hid: 'sss', links: { al: '140000' } } });
            }
            if (url.pathname === '/comick/comic/sss/chapters') {
                return json({
                    chapters: [1, 2, 3].map((number) => ({ hid: `sss${number}`, chap: String(number), up_count: 1 })),
                });
            }
            // The newest chapter has no comments yet; the one before has.
            if (url.pathname === '/comick/comment/chapter/sss3') {
                return json({ comments: [] });
            }
            if (url.pathname === '/comick/comment/chapter/sss2') {
                return json({
                    comments: [
                        {
                            id: 1,
                            content: 'Chapter 2 talk',
                            up_count: 2,
                            identities: { traits: { username: 'u' } },
                        },
                    ],
                });
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
    const seriesSearches = () => muRequests.filter(({ path }) => path === '/v1/series/search');
    const cardTitles = () =>
        page
            .locator('[aria-label] img')
            .evaluateAll(() => [])
            .then(() =>
                page.evaluate(() =>
                    [...document.querySelectorAll('button[aria-label]')].map((button) =>
                        button.getAttribute('aria-label'),
                    ),
                ),
            );

    await page.goto(`${ORIGIN}/discover`);
    await page.getByRole('button', { name: 'Tags & genres' }).click();
    const search = page.getByRole('textbox', { name: 'Search tags' });
    await search.fill('system');
    await page
        .getByRole('button', { name: /^System · 602 titles$/ })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const suggestions = page.getByRole('group', { name: 'Tag suggestions' });
    const chipLabels = await suggestions.locator('.MuiChip-label').allTextContents();
    check(
        label('typing "system" offers one System chip (602 titles), plus the other MU system categories'),
        chipLabels.filter((text) => text.startsWith('System ·')).length === 1 &&
            chipLabels.some((text) => text.startsWith('Level System')) &&
            !chipLabels.some((text) => text.startsWith('System Admin')),
        chipLabels,
    );
    check(label('no MU series search before a chip is picked'), seriesSearches().length === 0, muRequests.length);

    await page.getByRole('button', { name: /^System · 602 titles$/ }).click();
    await page
        .getByRole('button', { name: 'Raw Only Title' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    const beforeMatch = await cardTitles();
    check(
        label('MU cards show before any AniList match lands (matching held back)'),
        !aniList.counts.TsujiMuMatch &&
            ['SSS-Class Revival Hunter', 'Pick Me Up!', 'Log-In Murim', 'Raw Only Title'].every((title) =>
                beforeMatch.includes(title),
            ),
        { beforeMatch, counts: aniList.counts },
    );
    const muCovers = await page
        .locator('img[src*="cdn.mangaupdates.com"]')
        .evaluateAll((images) => images.map((image) => image.getAttribute('crossorigin')));
    check(
        label('MU covers load without crossOrigin (MU sends no CORS headers)'),
        muCovers.length > 0 && muCovers.every((value) => value === null),
        muCovers,
    );
    releaseMatches();
    await page
        .getByRole('button', { name: 'Solo Leveling' })
        .waitFor({ state: 'detached', timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(800);
    const titles = await cardTitles();
    check(
        label('System (Manhwa): SSS-Class, Pick Me Up!, Log-In Murim and the unmatched raw-only title'),
        ['SSS-Class Revival Hunter', 'Pick Me Up!', 'Log-In Murim', 'Raw Only Title'].every((title) =>
            titles.includes(title),
        ),
        titles,
    );
    check(
        label(
            'hidden: on my AniList as Completed (Solo Leveling), adult on MU (Sextopwatch), adult on AniList, a manga',
        ),
        !['Solo Leveling', 'Sextopwatch', 'Grown-Up Match', 'System Manga From Japan'].some((title) =>
            titles.includes(title),
        ),
        titles,
    );
    const pickMe = page.locator('button[aria-label="Pick Me Up!"]').locator('xpath=..');
    check(
        label('"Pick Me Up!" matches the Korean 2022 entry, not the Japanese title with that synonym; Planned badge'),
        (await pickMe.innerText().catch(() => '')).includes('Planned'),
        await pickMe.innerText().catch(() => ''),
    );
    const systemQueries = seriesSearches().map(({ body }) => body);
    check(
        label('MU queries: one per category of the chip, type Manhwa, adult genres excluded'),
        JSON.stringify(systemQueries.map(({ category }) => category)) ===
            JSON.stringify([['System'], ['Level System'], ['Stat System']]) &&
            systemQueries.every(
                ({ type, exclude_genre: excludeGenre, orderby }) =>
                    JSON.stringify(type) === '["Manhwa"]' &&
                    JSON.stringify(excludeGenre) === '["Adult","Hentai","Smut"]' &&
                    orderby === 'rating',
            ),
        systemQueries,
    );
    check(
        label('MU titles matched to AniList in one batched request'),
        aniList.counts.TsujiMuMatch === 1,
        aniList.counts,
    );

    // System + Martial Arts (AniList tag, also an MU genre): MU filters by genre, only murim system titles stay.
    await search.fill('martial');
    await page
        .getByRole('button', { name: 'Martial Arts' })
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    await suggestions.getByRole('button', { name: 'Martial Arts' }).click();
    // MU's own budget (20/min) spaces the new queries out: wait for the result, not a fixed time.
    await page
        .getByRole('button', { name: 'SSS-Class Revival Hunter' })
        .waitFor({ state: 'detached', timeout: 30_000 })
        .catch(() => {});
    await page
        .getByRole('button', { name: 'Log-In Murim' })
        .waitFor({ timeout: 30_000 })
        .catch(() => {});
    const murim = await cardTitles();
    const murimQueries = seriesSearches()
        .slice(3)
        .map(({ body }) => body);
    check(
        label('System + Martial Arts: sent to MU as genre, leaves Log-In Murim only'),
        murim.includes('Log-In Murim') &&
            !murim.includes('SSS-Class Revival Hunter') &&
            !murim.includes('Raw Only Title') &&
            murimQueries.length === 3 &&
            murimQueries.every(({ genre }) => JSON.stringify(genre) === '["Martial Arts"]'),
        { murim, murimQueries },
    );

    // Preview: no comments / reviews calls until a tab is opened; then verified by links.al.
    await page.getByRole('button', { name: 'Clear' }).click();
    await search.fill('system');
    await page.getByRole('button', { name: /^System · 602 titles$/ }).click();
    await page
        .getByRole('button', { name: 'SSS-Class Revival Hunter' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(800);
    check(
        label('picking System again asks MU nothing (identical searches answered from memory)'),
        seriesSearches().length === 6,
        seriesSearches().length,
    );
    const commentsBefore = relayRequests.filter(
        (request) => request.includes('/comick/') || request.includes('/mangadex/'),
    ).length;
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
        relayRequests.filter((request) => request.includes('/comick/') || request.includes('/mangadex/')).length ===
            commentsBefore && (aniList.counts.TsujiReviews ?? 0) === reviewsBefore,
        {},
    );
    await dialog.getByRole('tab', { name: 'Comments' }).click();
    await dialog
        .getByText('Chapter 2 talk')
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    check(
        label('Comments: the Comick series whose links.al is the AniList id, on its newest chapter with comments'),
        (await dialog
            .getByText('Chapter 2 talk')
            .isVisible()
            .catch(() => false)) &&
            (await dialog
                .getByRole('button', { name: 'Choose chapter' })
                .textContent()
                .catch(() => '')) === 'Ch. 2',
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

    await page.getByRole('button', { name: 'Log-In Murim' }).click({ button: 'right' });
    await dialog.getByRole('tab', { name: 'Comments' }).click();
    await dialog
        .getByText('No comments found')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    check(
        label('a look-alike Comick title with another links.al: "No comments found"'),
        await dialog
            .getByText('No comments found')
            .isVisible()
            .catch(() => false),
        {},
    );
    await page.keyboard.press('Escape');

    await page.getByRole('button', { name: 'Raw Only Title' }).click({ button: 'right' });
    await dialog.getByRole('tab', { name: 'Comments' }).click();
    check(
        label('an MU card without AniList match: "No comments found", no Reviews tab'),
        (await dialog
            .getByText('No comments found')
            .isVisible()
            .catch(() => false)) && (await dialog.getByRole('tab', { name: 'Reviews' }).count()) === 0,
        {},
    );
    await page.keyboard.press('Escape');

    // AniList-backed chips only (merged Dungeon): AniList search, zero MU series searches.
    await page.getByRole('button', { name: 'Clear' }).click();
    const searchesBefore = seriesSearches().length;
    await search.fill('dungeon');
    await page
        .getByRole('button', { name: /^Dungeon · 586 titles$/ })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const dungeonChips = (await suggestions.locator('.MuiChip-label').allTextContents()).filter((text) =>
        text.startsWith('Dungeon'),
    );
    check(
        label('"Dungeon" is one merged chip (AniList Dungeon + MU Dungeon/s)'),
        dungeonChips.length === 1,
        dungeonChips,
    );
    await page.getByRole('button', { name: /^Dungeon · 586 titles$/ }).click();
    await page
        .getByRole('button', { name: 'AniList Dungeon Title' })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    check(
        label('a search whose chips all have AniList backing runs on AniList and makes no MU series search'),
        (await page
            .getByRole('button', { name: 'AniList Dungeon Title' })
            .isVisible()
            .catch(() => false)) && seriesSearches().length === searchesBefore,
        { searches: seriesSearches().length - searchesBefore },
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
