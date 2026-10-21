/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the Similar fill (brief #14) on the production build (mocked Suwayomi, fixture AniList, fake
// MangaBaka): a series with few recommendations is filled with titles sharing its most distinctive MangaBaka tags,
// labeled "Same tags as <title>"; library titles never show, read or not; 2 MangaBaka requests, cached.
//
// Usage: pnpm build && node tools/scripts/tsuji/similar-fill.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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
/** AniList recommendations: 4 to show, 2 titles in the library with nothing read (hidden by the one hide rule). */
const RECS = [100, 101, 102, 103];
const LIBRARY_IDS = [200, 201];
/** The fill's AniList ids (one is a library title, one repeats a recommendation, one is the seed itself). */
const FILL_IDS = [...Array.from({ length: 14 }, (_, index) => 300 + index), 200, 101, SEED_ID];

const media = (id) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: `Rec ${id}`, english: `Rec ${id}`, romaji: null },
    coverImage: { large: null },
    description: 'A test title.',
    averageScore: 70 + (id % 20),
    meanScore: null,
    popularity: 5000 + id,
    favourites: 0,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: { year: 2020, month: 1, day: 1 },
    tags: [
        { name: 'Action', rank: 80, category: 'Theme', isMediaSpoiler: false, isGeneralSpoiler: false, isAdult: false },
    ],
});

const answerAniList = ({ query, variables = {} }) => {
    const operation = query.match(/query\s+(\w+)/)?.[1];
    switch (operation) {
        case 'TsujiSearch':
            return {
                Page: {
                    media: [
                        {
                            id: SEED_ID,
                            title: {
                                romaji: 'Fill Test',
                                english: 'Fill Test',
                                native: null,
                                userPreferred: 'Fill Test',
                            },
                            synonyms: [],
                        },
                    ],
                },
            };
        case 'TsujiSimilarSeed':
            return {
                Media: {
                    id: SEED_ID,
                    idMal: null,
                    tags: media(0).tags,
                    recommendations: {
                        nodes: [...RECS, ...LIBRARY_IDS].map((id, index) => ({
                            rating: 100 - index,
                            mediaRecommendation: media(id),
                        })),
                    },
                },
            };
        case 'TsujiBakaDetails':
            return { Page: { media: (variables.ids ?? []).map(media) } };
        case 'TsujiMyList':
            return { MediaListCollection: { lists: [] } };
        default:
            return {};
    }
};

const libraryManga = (id) => ({
    id,
    title: `Library ${id}`,
    unreadCount: 30,
    chapters: { totalCount: 30 },
    trackRecords: { nodes: [{ id, trackerId: 2, remoteId: String(id) }] },
});

const bakaTag = (id, count, weight) => ({ id, parent_id: null, series_count: count, weight, is_spoiler: false });

/** Fake MangaBaka: the seed's tags (11-13 the most distinctive usable ones), and one search answering any of them. */
const createBaka = () => {
    const requests = [];
    const answer = (url) => {
        requests.push(url.pathname + url.search);
        if (url.pathname === `/v1/source/anilist/${SEED_ID}`) {
            return {
                status: 200,
                data: {
                    series: [
                        {
                            id: 1,
                            title: 'Fill Test',
                            source: { anilist: { id: SEED_ID } },
                            tags_v2: [
                                bakaTag(14, 5000, 'defining'),
                                bakaTag(13, 500, 'recurrent'),
                                bakaTag(12, 90, 'defining'),
                                bakaTag(11, 60, 'core'),
                                bakaTag(15, 10, 'core'),
                            ],
                        },
                    ],
                },
            };
        }
        if (url.pathname === '/v1/series/search') {
            const rows = FILL_IDS.map((anilistId, index) => ({
                id: anilistId === SEED_ID ? 1 : 10 + index,
                title: `Baka ${anilistId}`,
                type: 'manhwa',
                rating: 75,
                popularity: { global: { current: index + 1 } },
                source: { anilist: { id: anilistId } },
                tags_v2: [bakaTag(11 + (index % 3), 60, 'core')],
            }));
            return { data: rows, pagination: { count: rows.length, next: null } };
        }
        return null;
    };
    return { requests, answer };
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
    const label = (text) => `[${browserName}] ${text}`;
    const baka = createBaka();
    const manga = {
        id: MANGA_ID,
        title: 'Fill Test',
        sourceId: '1',
        inLibrary: true,
        genre: [],
        source: { id: '1', name: 'Local source', displayName: 'Local source' },
    };
    const server = createMockSuwayomi({
        manga,
        chapters: [],
        pageCount: 0,
        // The library: this title and two more with nothing read.
        handlers: {
            'Query.mangas': () => ({
                nodes: [manga, ...LIBRARY_IDS.map(libraryManga)],
                totalCount: 3,
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
            }),
        },
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
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
                body: JSON.stringify({ data: answerAniList(request.postDataJSON()) }),
            });
        }
        if (url.host === 'api.mangabaka.org') {
            const result = baka.answer(url);
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
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
    const fillRow = page.getByRole('group', { name: 'Same tags as Fill Test' });
    await fillRow.waitFor({ timeout: 20_000 }).catch(() => {});

    const titlesIn = (name) =>
        page
            .getByRole('group', { name })
            .locator('[aria-label^="Rec "]')
            .evaluateAll((cards) => cards.map((card) => card.getAttribute('aria-label')));
    const similar = await titlesIn('Similar titles');
    const fill = await titlesIn('Same tags as Fill Test');
    const all = [...similar, ...fill];
    check(
        label('a thin Similar (4 cards) is filled from MangaBaka, labeled, to 12+ cards and at most 24'),
        similar.length === 4 &&
            (await page.getByRole('heading', { name: 'Same tags as Fill Test' }).isVisible()) &&
            all.length >= 12 &&
            all.length <= 24,
        { similar, fill },
    );
    check(
        label('no library title (nothing read in it), no repeat, not the series itself'),
        LIBRARY_IDS.every((id) => !all.includes(`Rec ${id}`)) &&
            new Set(all).size === all.length &&
            !all.includes(`Rec ${SEED_ID}`),
        all,
    );
    const search = new URLSearchParams(
        baka.requests.find((path) => path.startsWith('/v1/series/search'))?.split('?')[1],
    );
    check(
        label('2 MangaBaka requests: the series by AniList id, one search for its 3 most distinctive tags, any rating'),
        baka.requests.length === 2 &&
            search.getAll('tag').join() === '11,12,13' &&
            search.get('tag_mode') === 'or' &&
            search.getAll('content_rating').length === 4,
        baka.requests,
    );

    await page.reload();
    await page
        .getByRole('group', { name: 'Same tags as Fill Test' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    check(
        label('reload: the fill again from the cache (0 MangaBaka requests)'),
        (await page.getByRole('group', { name: 'Same tags as Fill Test' }).isVisible()) && baka.requests.length === 2,
        baka.requests,
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
