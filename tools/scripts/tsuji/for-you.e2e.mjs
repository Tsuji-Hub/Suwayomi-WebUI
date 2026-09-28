/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of Discover > For You on the production build (build/, or BUILD_DIR): an in-memory Suwayomi
// (mockSuwayomi.mjs) and a fixture AniList (graphql.anilist.co answered by the test). Checks the tab renders the
// week's picks and seed rows from 3 AniList requests, applies the list badges, and serves a reload from the week
// cache without asking AniList again.
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

const media = (id, overrides = {}) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: `Pick ${id}`, english: `Pick ${id}`, romaji: null },
    coverImage: { large: null },
    description: 'A test title.',
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
    tags: TASTE_TAGS.slice(id % 3),
    ...overrides,
});

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
            case 'TsujiForYouRecall':
                return {
                    core: { media: [media(PLANNED_ID), media(51), media(52)] },
                    rotating: { media: [media(53), media(54)] },
                };
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
            title: 'Unused',
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local' },
        },
        chapters: [],
        pageCount: 0,
    });
    const aniList = createAniList();
    const pageErrors = [];

    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.host === 'graphql.anilist.co') {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            const body = request.postDataJSON();
            return route.fulfill({
                status: 200,
                headers: { ...CORS, 'content-type': 'application/json' },
                body: JSON.stringify({ data: aniList.answer(body) }),
            });
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
    const topPicks = page.getByRole('heading', { name: 'Top picks' });
    await topPicks.waitFor({ timeout: 20_000 }).catch(() => {});

    check(label('top picks render'), await topPicks.isVisible(), {});
    const bodyText = await page.locator('body').innerText();
    const seedRows = (bodyText.match(/Because you read Liked \d/g) ?? []).length;
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
        bodyText.indexOf('Pick 1\n') < bodyText.indexOf('Pick 100'),
        {},
    );
    check(label('a title already on the list is never recommended'), !bodyText.includes('Pick 1003'), {});
    check(
        label('planned title shown with its badge (hide Planned is off by default)'),
        bodyText.includes(`Pick ${PLANNED_ID}`) && bodyText.includes('Planned'),
        {},
    );
    check(
        label('3 AniList requests for the week'),
        aniList.counts.TsujiTasteList === 1 &&
            aniList.counts.TsujiForYouSeeds === 1 &&
            aniList.counts.TsujiForYouRecall === 1,
        aniList.counts,
    );

    // Reload: the tab is remembered for the session and the week comes from the cache.
    await page.reload();
    await page
        .getByRole('heading', { name: 'Top picks' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    check(
        label('reload: For You again, from the week cache (no new For You requests)'),
        (await page.getByRole('heading', { name: 'Top picks' }).isVisible()) &&
            aniList.counts.TsujiForYouSeeds === 1 &&
            aniList.counts.TsujiTasteList === 1,
        aniList.counts,
    );

    // Refresh: refetches the list and the week.
    await page.getByRole('button', { name: 'Refresh' }).click();
    await page.waitForTimeout(1500);
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
