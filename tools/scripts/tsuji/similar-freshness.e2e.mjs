/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of brief #21 on the production build (mocked Suwayomi, fixture AniList, fake relay): Similar hides
// Comick cards by their AniList id (library meta, list status) like AniList's, drops Comick's repeat of an AniList card
// (keeping its chapter date), sorts "Top rated" as one list (AniList scores for Comick cards in one batched request,
// Comick-only cards "CK"), tags ongoing cards "> 6 MO" / "> 1 YR", never calls api.mangabaka.dev and shrugs off a
// MangaBaka 503; Discover hides the same titles.
//
// Usage: pnpm build && node tools/scripts/tsuji/similar-freshness.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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

const MANGA_ID = 438;
const SEED_ID = 5000;
const SEED_TITLE = 'Fresh Test';
/** In the library only by its tsuji_anilistId meta (another title, no track record). */
const LIBRARY_META_ID = 133_070;
/** Completed on the AniList list. */
const LIST_ID = 163_824;
const SCORED_ID = 700;
/**
 * As live on /manga/438 (r3456 / r3457 checks): Comick's "...Divine Pets!404" entry has no AniList link and no linked
 * twin on Comick (its other entry is unlinked too); AniList has it as 202246 (the English title is a synonym, the
 * Chinese one native). "Wang You: ..." is a different series, linked on Comick, sharing no title with it.
 */
const PETS_ID = 202_246;
const PETS = 'Starting As The God Of Wealth, Taming Billions Of Divine Pets!';
const PETS_NATIVE = '开局转职财神，驯化亿万神宠!';
const WANG_YOU_ID = 300_300;
const WANG_YOU = 'Wang You: Gua Ji Baiwan Nian, Wo Xinglai Cheng Shen';
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (days) => new Date(Date.now() - days * DAY).toISOString();

const media = (id, overrides = {}) => ({
    id,
    idMal: null,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: `Rec ${id}`, english: `Rec ${id}`, romaji: null },
    coverImage: { large: null },
    description: 'A test title.',
    averageScore: 70,
    meanScore: null,
    popularity: 5000,
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
    ...overrides,
});

/** AniList's recommendations: 103 is being read (hidden), 104 only planned (shown), 101 finished (no lookup). */
const AL_RECS = [
    media(100, { averageScore: 85 }),
    media(101, { averageScore: 70, status: 'FINISHED' }),
    media(102, { averageScore: 60 }),
    media(103, { averageScore: 99 }),
    media(104, { averageScore: 74 }),
];

/** Comick's recommendations (relates carry no AniList id or date) and what a search by their title says. */
const COMICK_RECS = [
    {
        slug: 'starting-as-the-god-of-wealth-taming-billions-of-divine-pets-404',
        title: `${PETS}404`,
        rating: '4.9',
        anilist: null,
        uploaded: 10,
        alt: [PETS_NATIVE],
    },
    { slug: 'library-one', title: 'Library One', rating: '9.9', anilist: LIBRARY_META_ID, uploaded: 10 },
    { slug: 'list-one', title: 'List One', rating: '9.8', anilist: LIST_ID, uploaded: 10 },
    { slug: 'comick-only', title: 'Comick Only', rating: '9.5', anilist: null, uploaded: 400 },
    { slug: 'comick-scored', title: 'Comick Scored', rating: '6.0', anilist: SCORED_ID, uploaded: 200 },
    // The same series as AniList's card 100: dropped, its date kept for that card.
    { slug: 'rec-100', title: 'Rec 100', rating: '7.0', anilist: 100, uploaded: 250 },
    {
        slug: 'wang-you-gua-ji-baiwan-nian-wo-xinglai-cheng-shen',
        title: WANG_YOU,
        rating: '6.9',
        anilist: WANG_YOU_ID,
        uploaded: 10,
        alt: ['网游：挂机百万年，我醒来成神'],
    },
];
/** Search rows for AniList-only cards (the lazy freshness lookup); 104 has none. */
const LOOKUPS = { 'Rec 102': { slug: 'rec-102', anilist: 102, uploaded: 500 } };

const searchRow = ({ slug, title, rating = '7.0', anilist, uploaded, alt = [] }) => ({
    id: slug.length,
    hid: `h-${slug}`,
    slug,
    title,
    country: 'kr',
    status: 1,
    last_chapter: 50,
    bayesian_rating: rating,
    user_follow_count: 1000,
    uploaded_at: daysAgo(uploaded),
    external_ids: anilist ? { anilist: String(anilist) } : {},
    md_covers: [],
    md_titles: alt.map((alternative) => ({ title: alternative, lang: 'zh' })),
    genres: [],
});

const createRelay = () => {
    const searches = [];
    const answer = (url) => {
        const path = url.pathname.replace(/^\/comick/, '');
        if (path === '/v1.0/search') {
            const q = url.searchParams.get('q');
            searches.push(q);
            if (q === SEED_TITLE) {
                return [searchRow({ slug: 'fresh-test', title: SEED_TITLE, anilist: SEED_ID, uploaded: 3 })];
            }
            if (q === PETS_NATIVE) {
                // Comick's other entry for it: unlinked too.
                return [
                    searchRow(COMICK_RECS[0]),
                    searchRow({
                        slug: 'kaiju-zhuanzhi-caishen-xunhua-yiwan-shenchong',
                        title: 'Kaiju Zhuanzhi Caishen, Xunhua Yiwan Shenchong',
                        anilist: null,
                        uploaded: 5,
                        alt: [PETS_NATIVE],
                    }),
                ];
            }
            const rec = COMICK_RECS.find(({ title }) => title === q);
            if (rec) {
                return [searchRow(rec)];
            }
            const lookup = LOOKUPS[q];
            return lookup ? [searchRow({ ...lookup, title: q })] : [];
        }
        if (path === '/comic/fresh-test/') {
            return {
                comic: {
                    hid: 'h-fresh',
                    links: { al: String(SEED_ID) },
                    recommendations: COMICK_RECS.map(({ slug, title, rating }, index) => ({
                        total: 50 - index,
                        relates: { slug, title, hid: `h-${slug}`, bayesian_rating: rating, user_follow_count: 900 },
                    })),
                },
            };
        }
        if (path === '/genre/') {
            return [];
        }
        return null;
    };
    return { searches, answer };
};

const createAniList = () => {
    const calls = [];
    const answer = ({ query, variables = {} }) => {
        const operation = query.match(/query\s+(\w+)/)?.[1];
        calls.push({ operation, variables });
        switch (operation) {
            case 'TsujiSearch':
                if (variables.search === PETS || variables.search === PETS_NATIVE) {
                    return {
                        Page: {
                            media: [
                                {
                                    id: PETS_ID,
                                    title: {
                                        romaji: 'Kaiju Zhuanzhi Caishen, Xunhua Yiwan Shen Chong!',
                                        english: null,
                                        native: PETS_NATIVE,
                                        userPreferred: 'Kaiju Zhuanzhi Caishen, Xunhua Yiwan Shen Chong!',
                                    },
                                    synonyms: [PETS],
                                },
                            ],
                        },
                    };
                }
                return {
                    Page: {
                        media: [
                            {
                                id: SEED_ID,
                                title: {
                                    romaji: SEED_TITLE,
                                    english: SEED_TITLE,
                                    native: null,
                                    userPreferred: SEED_TITLE,
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
                            nodes: AL_RECS.map((item, index) => ({ rating: 100 - index, mediaRecommendation: item })),
                        },
                    },
                };
            case 'TsujiScores':
                return {
                    Page: {
                        media: (variables.ids ?? [])
                            .filter((id) => [SCORED_ID, PETS_ID, WANG_YOU_ID].includes(id))
                            .map((id) => ({
                                id,
                                averageScore: { [SCORED_ID]: 90, [PETS_ID]: 54, [WANG_YOU_ID]: 49 }[id],
                                meanScore: null,
                                popularity: 20_000,
                            })),
                    },
                };
            case 'TsujiMyList':
                return {
                    MediaListCollection: {
                        lists: [
                            {
                                isCustomList: false,
                                entries: [
                                    { mediaId: 103, status: 'CURRENT', progress: 5 },
                                    { mediaId: 104, status: 'PLANNING', progress: 0 },
                                    { mediaId: LIST_ID, status: 'COMPLETED', progress: 80 },
                                ],
                            },
                        ],
                    },
                };
            case 'TsujiDiscoverPage':
                return {
                    Page: {
                        pageInfo: { hasNextPage: false },
                        media: [
                            media(LIBRARY_META_ID, {
                                title: { userPreferred: 'AL Library', english: 'AL Library', romaji: null },
                            }),
                            media(LIST_ID, {
                                title: { userPreferred: 'AL Listed', english: 'AL Listed', romaji: null },
                            }),
                            media(900, {
                                title: { userPreferred: 'Discover Keep', english: 'Discover Keep', romaji: null },
                            }),
                        ],
                    },
                };
            default:
                return {};
        }
    };
    return { calls, answer };
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

const scoreOf = (text) => Number(text.match(/(\d+)%/)?.[1] ?? -1);

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;
    const relay = createRelay();
    const aniList = createAniList();
    const hosts = new Set();
    const bakaStatuses = [];
    const manga = {
        id: MANGA_ID,
        title: SEED_TITLE,
        sourceId: '1',
        inLibrary: true,
        genre: [],
        source: { id: '1', name: 'Local source', displayName: 'Local source' },
    };
    const libraryOnlyByMeta = {
        id: 50,
        title: 'Some Other Library Name',
        unreadCount: 30,
        chapters: { totalCount: 30 },
        trackRecords: { nodes: [] },
        meta: [{ mangaId: 50, key: 'tsuji_anilistId', value: String(LIBRARY_META_ID) }],
    };
    const server = createMockSuwayomi({
        manga,
        chapters: [],
        pageCount: 0,
        globalMeta: { tsuji_recFilters: JSON.stringify({ sort: 'SCORE' }) },
        handlers: {
            'Query.mangas': () => ({
                nodes: [manga, libraryOnlyByMeta],
                totalCount: 2,
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
            }),
        },
    });

    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        hosts.add(url.host);
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
        if (url.host === 'api.mangabaka.org') {
            // MangaBaka down: Similar goes on without it.
            bakaStatuses.push(503);
            return route.fulfill({ status: 503, headers: CORS, body: 'unavailable' });
        }
        if (url.origin === RELAY) {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET' } });
            }
            const result = url.pathname.startsWith('/comick/') ? relay.answer(url) : null;
            return route.fulfill(
                result === null
                    ? { status: 404, headers: CORS, body: '' }
                    : {
                          status: 200,
                          headers: { ...CORS, 'content-type': 'application/json' },
                          body: JSON.stringify(result),
                      },
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
    await context.routeWebSocket(/.*/, () => {});

    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);

    const row = page.getByRole('group', { name: 'Similar titles' });
    const readCards = () =>
        row.locator('button[aria-label]:not([aria-label="More actions"])').evaluateAll((buttons) =>
            buttons.map((button) => ({
                title: button.getAttribute('aria-label'),
                text: button.innerText.replaceAll('\n', ' '),
            })),
        );
    // Until the Comick cards are in and scored.
    const waitCards = async (isDone) => {
        for (let attempt = 0; attempt < 60; attempt += 1) {
            // oxlint-disable-next-line no-await-in-loop
            const found = await readCards().catch(() => []);
            if (isDone(Object.fromEntries(found.map((card) => [card.title, card.text])))) {
                return found;
            }
            // oxlint-disable-next-line no-await-in-loop
            await page.waitForTimeout(500);
        }
        return readCards().catch(() => []);
    };
    await waitCards((byTitle) => byTitle['Comick Only'] && byTitle['Comick Scored']?.includes('90%'));
    // Rec 102 (last in the row) is looked up once it nears the screen.
    await row.locator('button[aria-label="Rec 102"]').scrollIntoViewIfNeeded();
    const cards = await waitCards((byTitle) => byTitle['Rec 102']?.includes('YR'));
    const titles = cards.map(({ title }) => title);
    const textOf = (title) => cards.find((card) => card.title === title)?.text ?? '';

    check(
        label(
            'hides the library series (tsuji_anilistId meta) and the list series (COMPLETED) that only Comick recommends',
        ),
        !titles.includes('Library One') && !titles.includes('List One'),
        titles,
    );
    check(
        label('hides the series being read (CURRENT), keeps the planned one; Comick repeat of an AniList card dropped'),
        !titles.includes('Rec 103') && titles.includes('Rec 104') && titles.filter((t) => t === 'Rec 100').length === 1,
        titles,
    );
    check(
        label(
            '"...!404" found on AniList by title (202246, 54 %, no CK, no "404"); "Wang You" stays its own card (49 %)',
        ),
        !titles.includes(`${PETS}404`) &&
            titles.filter((title) => title === PETS).length === 1 &&
            textOf(PETS).includes('54%') &&
            !/CK/.test(textOf(PETS)) &&
            titles.filter((title) => title === WANG_YOU).length === 1 &&
            textOf(WANG_YOU).includes('49%') &&
            aniList.calls.some(({ operation, variables }) => operation === 'TsujiSearch' && variables.search === PETS),
        { titles, pets: textOf(PETS), wangYou: textOf(WANG_YOU) },
    );
    const scores = cards.map(({ text }) => scoreOf(text));
    check(
        label('Top rated: one list across sources, scores never increase'),
        JSON.stringify(titles) ===
            JSON.stringify([
                'Comick Only',
                'Comick Scored',
                'Rec 100',
                'Rec 104',
                'Rec 101',
                'Rec 102',
                PETS,
                WANG_YOU,
            ]) && scores.every((score, index) => index === 0 || score <= scores[index - 1]),
        { titles, scores },
    );
    check(
        label('CK on the Comick-only score (95), AniList score on the Comick card with an AniList id (90, no CK)'),
        /95%\s*CK/.test(textOf('Comick Only')) &&
            textOf('Comick Scored').includes('90%') &&
            !/CK/.test(textOf('Comick Scored')),
        { comickOnly: textOf('Comick Only'), comickScored: textOf('Comick Scored') },
    );
    check(
        label(
            'freshness: > 1 YR (Comick 400 d, lookup 500 d), > 6 MO (Comick 200 d, AniList card dated by Comick 250 d)',
        ),
        textOf('Comick Only').includes('> 1 YR') &&
            textOf('Rec 102').includes('> 1 YR') &&
            textOf('Comick Scored').includes('> 6 MO') &&
            textOf('Rec 100').includes('> 6 MO') &&
            !/> (1 YR|6 MO)/.test(textOf('Rec 101')) &&
            !/> (1 YR|6 MO)/.test(textOf('Rec 104')),
        Object.fromEntries(cards.map(({ title, text }) => [title, text])),
    );
    check(label('no lookup for the finished series'), !relay.searches.includes('Rec 101'), relay.searches);
    const scoreCalls = aniList.calls.filter(({ operation }) => operation === 'TsujiScores');
    check(
        label('one batched AniList score request for the Comick cards'),
        scoreCalls.length === 1 &&
            scoreCalls[0].variables.ids.includes(SCORED_ID) &&
            scoreCalls[0].variables.ids.length <= 50,
        scoreCalls,
    );
    check(
        label('no api.mangabaka.dev request; MangaBaka 503 is silent'),
        ![...hosts].some((host) => host.endsWith('mangabaka.dev')),
        { hosts: [...hosts], bakaStatuses },
    );

    await page.reload();
    await row.waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2000);
    check(
        label('reload: scores and the "...!404" lookup from the cache (no second request)'),
        aniList.calls.filter(({ operation }) => operation === 'TsujiScores').length === 1 &&
            aniList.calls.filter(({ variables }) => variables.search === PETS).length === 1,
        aniList.calls.map(({ operation }) => operation),
    );

    await page.goto(`${ORIGIN}/discover`);
    const keep = page.locator('button[aria-label="Discover Keep"]').first();
    await keep.waitFor({ timeout: 20_000 }).catch(() => {});
    check(
        label('Discover hides the same library (meta) and list titles'),
        (await keep.isVisible()) &&
            (await page.locator('button[aria-label="AL Library"]').count()) === 0 &&
            (await page.locator('button[aria-label="AL Listed"]').count()) === 0,
        {
            keep: await page.locator('button[aria-label="Discover Keep"]').count(),
            library: await page.locator('button[aria-label="AL Library"]').count(),
            listed: await page.locator('button[aria-label="AL Listed"]').count(),
        },
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
