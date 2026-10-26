/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the drop rate and drop map (brief #20) on the production build: a mocked Suwayomi library (Solo
// Leveling read to ch 110, Mythic Item Obtained, a series whose map is still being built, one with too few drops,
// one with too few readers), a fake relay (/drops/<id>, /drops/index.json) and a fixture AniList (statusDistribution).
// Checks the series page block (rate, band, map, cliff, marker, summary, footer, notes behind the spoiler guard), the
// pending map arriving without a reload, "Not enough drops to map", the AniList fallback with the relay down, the
// library chips from one index request and the Drop rate sort, and that Discover asks nothing per card while a
// preview / hover line asks the relay at most once per title.
//
// Usage: pnpm build && node tools/scripts/tsuji/drop-rate.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const RELAY = 'http://suwayomi.test:4568';
const VIEWPORT = { width: 1400, height: 1000 };

const SL = { id: 1, anilistId: 105398, title: 'Solo Leveling' };
const MYTHIC = { id: 2, anilistId: 151025, title: 'Mythic Item Obtained' };
const PENDING = { id: 3, anilistId: 777, title: 'Fresh Series' };
const FEW = { id: 4, anilistId: 888, title: 'Niche Series' };
const TINY = { id: 5, anilistId: 999, title: 'Tiny Series' };
/** Discover / preview only: not in the relay's index. */
const OUTSIDE_ID = 4242;
/** Discover only: in the relay's index, not in the library (library titles are hidden there, brief #21). */
const INDEXED_PICK_ID = 3131;
/** Discover only: the relay answers after 9 s (a cold title: over the old 8 s client timeout). */
const SLOW_ID = 5252;
const SLOW_MS = 9000;
/** Discover only: the relay is still mapping it (no numbers yet). */
const MAPPING_ID = 6363;

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

const dist = (started, dropPct) => {
    const dropped = Math.round((started * dropPct) / 100);
    const completed = Math.round(started * 0.5);
    const paused = Math.round(started * 0.05);
    return {
        CURRENT: started - dropped - completed - paused,
        COMPLETED: completed,
        DROPPED: dropped,
        PAUSED: paused,
        PLANNING: 1000,
    };
};

const buckets = (size, counts) => counts.map((count, index) => [index * size + 1, (index + 1) * size, count]);

const map = (overrides) => ({
    state: 'ready',
    n: 400,
    n_prog: 284,
    n_zero: 115,
    median: 80.5,
    bucket: 15,
    buckets: buckets(15, [48, 30, 27, 21, 9, 13, 10, 34, 11, 19, 22, 29, 6, 5]),
    early_share: 16.9,
    cliffs: [{ from: 106, to: 120, count: 34, share: 12.0 }],
    max: 210,
    dropper_score: 50.3,
    score_n: 196,
    sample: 'latest 400 public DROPPED lists on AniList (newest updates first)',
    ...overrides,
});

// Solo Leveling as the live relay answered it (brief #20).
const SL_ANSWER = {
    v: 1,
    id: SL.anilistId,
    title: 'Solo Leveling',
    status: 'FINISHED',
    chapters: 201,
    dist: { CURRENT: 84057, PLANNING: 44295, COMPLETED: 142208, DROPPED: 7736, PAUSED: 9524 },
    started: 243525,
    drop_pct: 3.2,
    map: map({}),
    notes: [
        { ch: 110, text: '#korean propaganda' },
        // Translated by al-drops (tr + orig).
        { ch: 67, text: 'Got boring after the tournament', tr: true, orig: 'Ficou chato depois do torneio' },
        { ch: 170, text: 'prime solo leveling was goated, but the ending fell off hard' },
    ],
};

const createRelay = () => {
    const state = { isDown: false, pendingCalls: 0, requests: [] };
    const answers = {
        [MYTHIC.anilistId]: () => ({
            id: MYTHIC.anilistId,
            chapters: null,
            dist: dist(30210, 7.1),
            map: map({
                median: 107,
                buckets: buckets(15, [20, 18, 15, 14, 12, 13, 16, 40, 12, 10]),
                early_share: 9,
                cliffs: [
                    { from: 106, to: 120, count: 40, share: 14.0 },
                    { from: 16, to: 30, count: 18, share: 9.0 },
                ],
                max: 150,
                n_prog: 170,
            }),
            notes: [],
        }),
        [PENDING.anilistId]: () => {
            state.pendingCalls += 1;
            return {
                id: PENDING.anilistId,
                chapters: 60,
                dist: dist(5000, 4.0),
                map:
                    state.pendingCalls <= 2
                        ? { state: 'pending', eta_s: 10 }
                        : map({
                              buckets: buckets(10, [5, 4, 9, 3, 2, 1]),
                              cliffs: [],
                              early_share: 4,
                              median: 25,
                              max: 60,
                          }),
                notes: [],
            };
        },
        [FEW.anilistId]: () => ({
            id: FEW.anilistId,
            chapters: 40,
            dist: dist(5000, 5.0),
            map: map({ n: 4, n_prog: 3, buckets: buckets(10, [1, 1, 1, 0]), cliffs: [], median: 12, max: 40 }),
            notes: [],
        }),
        [TINY.anilistId]: () => ({ id: TINY.anilistId, chapters: 10, dist: dist(150, 12.0), map: null, notes: [] }),
        [SLOW_ID]: () => ({
            id: SLOW_ID,
            chapters: 50,
            dist: dist(4000, 9.0),
            map: map({ buckets: buckets(10, [3, 30, 4, 2, 1]), cliffs: [{ from: 11, to: 20, count: 30, share: 60 }] }),
            notes: [],
        }),
        [MAPPING_ID]: () => ({ id: MAPPING_ID, map: { state: 'pending', eta_s: 30 } }),
        [OUTSIDE_ID]: () => ({
            id: OUTSIDE_ID,
            chapters: 90,
            dist: dist(8000, 6.0),
            map: map({
                buckets: buckets(20, [10, 12, 40, 9, 5]),
                cliffs: [{ from: 41, to: 60, count: 40, share: 30 }],
            }),
            notes: [],
        }),
    };
    const answer = (url) => {
        state.requests.push(url.pathname);
        if (url.pathname === '/drops/index.json') {
            return {
                status: 200,
                body: {
                    v: 1,
                    median_drop_pct: 5.1,
                    n: 5,
                    items: {
                        [SL.anilistId]: { drop_pct: 3.2, started: 243525, median: 80.5 },
                        [MYTHIC.anilistId]: { drop_pct: 7.1, started: 30210, median: 107 },
                        [FEW.anilistId]: { drop_pct: 5.0, started: 5000 },
                        [TINY.anilistId]: { drop_pct: 12.0, started: 150 },
                        // The live shape: [from, to, share %]; the biggest share is "most quit".
                        [INDEXED_PICK_ID]: {
                            drop_pct: 3.4,
                            started: 9000,
                            cliffs: [
                                [5, 10, 12],
                                [21, 40, 31],
                            ],
                        },
                    },
                },
            };
        }
        const id = Number(/^\/drops\/(\d+)$/.exec(url.pathname)?.[1]);
        if (id === SL.anilistId) {
            return { status: 200, body: SL_ANSWER };
        }
        return answers[id]
            ? { status: 200, body: answers[id]() }
            : { status: 404, body: { error: 'not found on AniList' } };
    };
    return { state, answer };
};

const createAniList = () => {
    const counts = {};
    const answer = ({ query, variables = {} }) => {
        const operation = query.match(/query\s+(\w+)/)?.[1] ?? 'unknown';
        counts[operation] = (counts[operation] ?? 0) + 1;
        if (operation === 'TsujiDropStats') {
            const distribution =
                variables.id === SL.anilistId ? SL_ANSWER.dist : dist(variables.id === OUTSIDE_ID ? 8000 : 100, 6.0);
            return {
                Media: {
                    id: variables.id,
                    chapters: null,
                    stats: {
                        statusDistribution: Object.entries(distribution).map(([status, amount]) => ({
                            status,
                            amount,
                        })),
                    },
                },
            };
        }
        if (operation === 'TsujiDiscoverPage') {
            return {
                Page: {
                    pageInfo: { hasNextPage: false },
                    media: [INDEXED_PICK_ID, OUTSIDE_ID, SLOW_ID, MAPPING_ID].map((id) => ({
                        id,
                        idMal: null,
                        siteUrl: null,
                        title: { userPreferred: `Pick ${id}`, english: `Pick ${id}`, romaji: null },
                        coverImage: { large: null },
                        description: 'A test title.',
                        averageScore: 80,
                        meanScore: null,
                        popularity: 50_000,
                        favourites: 0,
                        countryOfOrigin: 'KR',
                        format: 'MANGA',
                        status: 'RELEASING',
                        chapters: 100,
                        isAdult: false,
                        startDate: { year: 2020, month: 1, day: 1 },
                        tags: [],
                    })),
                },
            };
        }
        return {};
    };
    return { counts, answer };
};

const libraryEntry = ({ id, anilistId, title }, viaMeta) => ({
    id,
    title,
    sourceId: '1',
    inLibrary: true,
    genre: [],
    unreadCount: 5,
    source: { id: '1', name: 'Local source', displayName: 'Local source' },
    meta: viaMeta
        ? [{ key: 'tsuji_anilistId', value: String(anilistId), mangaId: id, __typename: 'MangaMetaType' }]
        : [],
    trackRecords: viaMeta
        ? { nodes: [] }
        : { totalCount: 1, nodes: [{ id: id * 10, trackerId: 2, remoteId: String(anilistId) }] },
    chapters: { totalCount: 50 },
    latestReadChapter: { id: id * 1000, chapterNumber: 10 },
    highestNumberedChapter: { id: id * 1000 + 1, chapterNumber: 50 },
});

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
    // Headless Firefox reports no fine pointer, so the reader would pick its mobile overlay: act like a desktop mouse.
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
    const relay = createRelay();
    const aniList = createAniList();
    const categoryMeta = [];

    const sl = {
        ...libraryEntry(SL, true),
        latestReadChapter: { id: 1110, chapterNumber: 110 },
        highestNumberedChapter: { id: 1200, chapterNumber: 200 },
        chapters: { totalCount: 200 },
    };
    const others = [MYTHIC, PENDING, FEW, TINY].map((entry) => libraryEntry(entry, entry === PENDING));
    const library = [sl, ...others];
    const server = createMockSuwayomi({
        manga: sl,
        chapters: [],
        pageCount: 0,
        extraMangas: others.map((manga) => ({ manga, chapters: [], pageCount: 0 })),
        handlers: {
            'Query.categories': () => ({
                nodes: [
                    {
                        id: 0,
                        name: 'Default',
                        order: 0,
                        default: true,
                        meta: categoryMeta,
                        mangas: {
                            nodes: library,
                            totalCount: library.length,
                            pageInfo: { hasNextPage: false, hasPreviousPage: false },
                        },
                    },
                ],
                totalCount: 1,
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
            }),
            'Query.category': () => ({
                id: 0,
                name: 'Default',
                order: 0,
                default: true,
                meta: categoryMeta,
                mangas: {
                    nodes: library,
                    totalCount: library.length,
                    pageInfo: { hasNextPage: false, hasPreviousPage: false },
                },
            }),
            'Query.mangas': () => ({
                nodes: library,
                totalCount: library.length,
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
            }),
        },
    });

    // The mock keeps the main manga's meta itself.
    server.mangaMeta.set('tsuji_anilistId', String(SL.anilistId));

    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin === RELAY) {
            if (relay.state.isDown) {
                return route.abort();
            }
            const { status, body } = relay.answer(url);
            if (url.pathname === `/drops/${SLOW_ID}`) {
                await new Promise((done) => {
                    setTimeout(done, SLOW_MS);
                });
            }
            return route.fulfill({
                status,
                headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        }
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
    // Subscriptions stay quiet but connected: a closed socket is retried, and after a minute and a half of test the
    // client gives up with an unhandled CloseEvent.
    await context.routeWebSocket(/.*/, (ws) => {
        ws.onMessage((message) => {
            const { type, id } = JSON.parse(String(message));
            if (type === 'connection_init') {
                ws.send(JSON.stringify({ type: 'connection_ack' }));
            }
            if (type === 'ping') {
                ws.send(JSON.stringify({ type: 'pong', id }));
            }
        });
    });
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const failedDrops = [];
    page.on('requestfailed', (request) => {
        const { pathname } = new URL(request.url());
        if (pathname.startsWith('/drops/')) {
            failedDrops.push(`${pathname} ${request.failure()?.errorText}`);
        }
    });
    page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));
    const block = page.getByRole('region', { name: 'Readers' }).or(page.locator('section[aria-label="Readers"]'));
    const blockText = async () =>
        (
            await block
                .first()
                .innerText()
                .catch(() => '')
        ).replaceAll(/\s+/g, ' ');
    const openSeries = async (mangaId) => {
        await page.goto(`${ORIGIN}/manga/${mangaId}`);
        await block
            .first()
            .waitFor({ timeout: 20_000 })
            .catch(() => {});
    };

    // 1. Solo Leveling: rate, band, map with the 106-120 cliff, marker at ch 110, summary, footer.
    await openSeries(SL.id);
    await page
        .getByText('Most drops', { exact: false })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    let text = await blockText();
    check(
        label('Solo Leveling: "3.2 % dropped", low vs the library median, "58 % finished · 4 % on hold"'),
        text.includes('3.2 % dropped') && text.includes('low') && text.includes('58 % finished · 4 % on hold'),
        { text },
    );
    const bars = await block.first().locator('[role="img"] > div:not([data-marker])').count();
    const cliffs = await block.first().locator('[data-cliff]').count();
    check(label('map: 14 bars, the 106-120 bucket highlighted'), bars === 14 && cliffs === 1, { bars, cliffs });
    check(
        label('summary and footer match the JSON'),
        text.includes('Most drops: ch 106-120 (12 %) · 17 % quit in ch 1-15 · half of droppers quit by ch 80') &&
            text.includes(
                'Based on the latest 400 public AniList drops (284 with progress) · Droppers rated it 50/100',
            ),
        { text },
    );
    const marker = Number(
        await block
            .first()
            .locator('[data-marker]')
            .getAttribute('data-marker')
            .catch(() => -1),
    );
    check(label('your position: the marker at ch 110 (110 / 210 of the strip)'), Math.abs(marker - 110 / 210) < 0.01, {
        marker,
    });
    // Notes: collapsed; ch 110 shows, ch 170 (past the reader) blurred until asked.
    check(
        label('notes collapsed by default'),
        !(await page
            .getByText('#korean propaganda')
            .isVisible()
            .catch(() => false)),
        {},
    );
    await page
        .getByRole('button', { name: /Reader notes/ })
        .click()
        .catch(() => {});
    const past = page.getByRole('button', { name: 'Show notes past ch 110' });
    await past.waitFor({ timeout: 5000 }).catch(() => {});
    const blurred = await page
        .getByText('the ending fell off hard', { exact: false })
        .evaluate((element) => getComputedStyle(element.closest('[aria-hidden]') ?? element).filter)
        .catch(() => '');
    check(
        label('notes: ch 110 shown, ch 170 blurred behind "Show notes past ch 110"'),
        (await page
            .getByText('#korean propaganda')
            .isVisible()
            .catch(() => false)) &&
            (await past.isVisible().catch(() => false)) &&
            blurred.includes('blur'),
        { blurred },
    );
    // A translated note: "· translated" after its chapter, a tap shows the original and back, no request.
    const requestsBeforeToggle = relay.state.requests.length;
    const translated = block.first().getByRole('button', { name: 'translated' });
    const english = await page
        .getByText('Got boring after the tournament')
        .isVisible()
        .catch(() => false);
    await translated.click().catch(() => {});
    const original = await page
        .getByText('Ficou chato depois do torneio')
        .isVisible()
        .catch(() => false);
    await translated.click().catch(() => {});
    const back = await page
        .getByText('Got boring after the tournament')
        .isVisible()
        .catch(() => false);
    check(
        label('translated note: English with "· translated", tap shows the original and back, no request'),
        english &&
            original &&
            back &&
            (await block.first().getByRole('button', { name: 'translated' }).count()) === 1 &&
            (await block.first().getByText('ch 67 · translated').count()) === 1 &&
            relay.state.requests.length === requestsBeforeToggle,
        { english, original, back, requests: relay.state.requests.slice(requestsBeforeToggle) },
    );

    await past.click().catch(() => {});
    const unblurred = await page
        .getByText('the ending fell off hard', { exact: false })
        .evaluate((element) => getComputedStyle(element.closest('[aria-hidden]') ?? element).filter)
        .catch(() => 'x');
    check(label('"Show notes past ch 110" reveals them'), !unblurred.includes('blur'), { unblurred });

    // 2. Mythic Item Obtained: 7.1 %, median 107, cliff 106-120 (ongoing: chapters null).
    await openSeries(MYTHIC.id);
    await page
        .getByText('Most drops', { exact: false })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    text = await blockText();
    check(
        label(
            'Mythic Item Obtained: 7.1 % (typical), both cliffs named, half quit by ch 107; marker on an ongoing series',
        ),
        text.includes('7.1 % dropped') &&
            text.includes('typical') &&
            text.includes('Most drops: ch 16-30 (9 %) and ch 106-120 (14 %)') &&
            text.includes('half of droppers quit by ch 107') &&
            (await block.first().locator('[data-marker]').count()) === 1,
        { text },
    );

    // 3. Pending: the rate at once, "Mapping where readers drop…", then the map without a reload.
    await openSeries(PENDING.id);
    await page
        .getByText('dropped', { exact: false })
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    text = await blockText();
    const mapping = page.getByText(/Mapping where readers drop… ~\d+ s/);
    check(
        label('pending: the rate at once and "Mapping where readers drop…"'),
        text.includes('4.0 % dropped') && (await mapping.isVisible().catch(() => false)),
        { text },
    );
    await page.evaluate(() => {
        window.tsujiNoReload = true;
    });
    await block
        .first()
        .locator('[role="img"]')
        .waitFor({ timeout: 40_000 })
        .catch(() => {});
    check(
        label('pending: the map arrives without a reload'),
        (await block.first().locator('[role="img"]').count()) === 1 &&
            !(await mapping.isVisible().catch(() => false)) &&
            (await page.evaluate(() => window.tsujiNoReload === true)),
        { pendingCalls: relay.state.pendingCalls },
    );

    // 4. Too few drops: the rate, "Not enough drops to map".
    await openSeries(FEW.id);
    await page
        .getByText('Not enough drops to map')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    text = await blockText();
    check(
        label('few drops: rate shown, "Not enough drops to map"'),
        text.includes('5.0 % dropped') && text.includes('Not enough drops to map'),
        { text },
    );

    // 4b. Under 200 starters: the rate, no low / typical / high.
    await openSeries(TINY.id);
    await page
        .getByText('12.0 % dropped')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    text = await blockText();
    check(
        label('150 starters: "12.0 % dropped" without a low / typical / high label'),
        text.includes('12.0 % dropped') && !/\b(low|typical|high)\b/.test(text),
        { text },
    );

    // 5. Library: one index request, chips (none under 200 starters), the Drop rate sort.
    const indexBefore = relay.state.requests.filter((path) => path === '/drops/index.json').length;
    await page.goto(`${ORIGIN}/library`);
    await page
        .getByText('▼3%')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    await page.waitForTimeout(1500);
    const indexRequests = relay.state.requests.filter((path) => path === '/drops/index.json').length - indexBefore;
    const chips = await page.getByText(/^▼\d+%$/).allInnerTexts();
    check(
        label('library: one index.json request (a fresh page), chips ▼3% / ▼7% / ▼5%, none for 150 starters'),
        indexRequests === 1 && ['▼3%', '▼7%', '▼5%'].every((chip) => chips.includes(chip)) && !chips.includes('▼12%'),
        { indexRequests, chips },
    );
    categoryMeta.push({ key: 'webUI_sortBy', value: 'tsujiDropRate', categoryId: 0, __typename: 'CategoryMetaType' });
    await page.goto(`${ORIGIN}/library`);
    await page
        .getByText('▼3%')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    await page.waitForTimeout(1500);
    const order = await page.evaluate(
        (titles) => {
            const bodyText = document.body.innerText;
            return titles
                .map((title) => ({ title, at: bodyText.indexOf(title) }))
                .sort((a, b) => a.at - b.at)
                .map(({ title }) => title);
        },
        [SL.title, MYTHIC.title, PENDING.title, FEW.title, TINY.title],
    );
    check(
        label('library sort "Drop rate": 3.2, 5.0, 7.1, 12.0, unknown last'),
        order.join('|') === [SL.title, FEW.title, MYTHIC.title, TINY.title, PENDING.title].join('|'),
        order,
    );

    // 6. Discover: no per-card drop request; a preview asks the relay at most once.
    const relayBefore = relay.state.requests.length;
    const statsBefore = aniList.counts.TsujiDropStats ?? 0;
    await page.goto(`${ORIGIN}/discover`);
    const outsideCard = page.getByRole('button', { name: `Pick ${OUTSIDE_ID}` }).first();
    await outsideCard.waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    // Per-card drop requests only (Comick freshness searches for ongoing cards are brief #21's).
    const discoverRelay = relay.state.requests
        .slice(relayBefore)
        .filter((path) => path.startsWith('/drops/') && path !== '/drops/index.json');
    check(
        label('Discover: zero per-card drop requests; ▼3% on the card in the index'),
        discoverRelay.length === 0 &&
            (aniList.counts.TsujiDropStats ?? 0) === statsBefore &&
            (await page.getByText('▼3%').count()) > 0,
        { discoverRelay, stats: aniList.counts.TsujiDropStats ?? 0 },
    );
    // The hover tooltip is a preview: the drop line from the index (its cliff), no request.
    const relayBeforeHover = relay.state.requests.length;
    await page
        .getByRole('button', { name: `Pick ${INDEXED_PICK_ID}` })
        .first()
        .hover();
    const hoverLine = page.getByRole('tooltip').getByText('▼ 3.4 % dropped · most quit ch 21-40');
    await hoverLine.waitFor({ timeout: 10_000 }).catch(() => {});
    check(
        label('hover tooltip: "▼ 3.4 % dropped · most quit ch 21-40" from the index, no request'),
        (await hoverLine.isVisible().catch(() => false)) &&
            relay.state.requests.slice(relayBeforeHover).every((path) => !path.startsWith('/drops/')),
        relay.state.requests.slice(relayBeforeHover),
    );
    await page.mouse.move(0, 0);

    // A short hover on a cold title: the request runs on (no abort, no AniList call) and fills the cache.
    const slowCard = page.getByRole('button', { name: `Pick ${SLOW_ID}` }).first();
    await slowCard.hover();
    await page.waitForTimeout(1200);
    await page.mouse.move(0, 0);
    await page.waitForTimeout(SLOW_MS);
    await slowCard.hover();
    const slowLine = page.getByRole('tooltip').getByText('▼ 9.0 % dropped · most quit ch 11-20');
    await slowLine.waitFor({ timeout: 5000 }).catch(() => {});
    const slowRequests = relay.state.requests.filter((path) => path === `/drops/${SLOW_ID}`).length;
    check(
        label('short hover on a cold title: one /drops request, not cut (> 8 s), cached, no AniList call'),
        (await slowLine.isVisible().catch(() => false)) &&
            slowRequests === 1 &&
            failedDrops.length === 0 &&
            (aniList.counts.TsujiDropStats ?? 0) === statsBefore,
        { slowRequests, failedDrops, stats: aniList.counts.TsujiDropStats ?? 0 },
    );
    await page.mouse.move(0, 0);

    // Still mapping: no line, no AniList call.
    await page
        .getByRole('button', { name: `Pick ${MAPPING_ID}` })
        .first()
        .hover();
    await page.waitForTimeout(1500);
    check(
        label('relay still mapping: no line, no AniList call'),
        relay.state.requests.includes(`/drops/${MAPPING_ID}`) &&
            (await page.getByRole('tooltip').getByText('% dropped').count()) === 0 &&
            (aniList.counts.TsujiDropStats ?? 0) === statsBefore,
        { stats: aniList.counts.TsujiDropStats ?? 0 },
    );
    await page.mouse.move(0, 0);

    const dropsBeforePreview = relay.state.requests.filter((path) => path === `/drops/${OUTSIDE_ID}`).length;
    await outsideCard.click({ button: 'right' }).catch(() => {});
    const preview = page.getByRole('dialog');
    const previewLine = preview.getByText('▼ 6.0 % dropped · most quit ch 41-60');
    await previewLine.waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const outsideRequests =
        relay.state.requests.filter((path) => path === `/drops/${OUTSIDE_ID}`).length - dropsBeforePreview;
    check(
        label('preview outside the index: "▼ 6.0 % dropped · most quit ch 41-60" from one /drops request'),
        (await previewLine.isVisible().catch(() => false)) &&
            outsideRequests === 1 &&
            (aniList.counts.TsujiDropStats ?? 0) === statsBefore,
        { outsideRequests, stats: aniList.counts.TsujiDropStats ?? 0 },
    );
    await page.keyboard.press('Escape');
    await outsideCard.click({ button: 'right' }).catch(() => {});
    await previewLine.waitFor({ timeout: 10_000 }).catch(() => {});
    check(
        label('preview again: cached for the session (no second request)'),
        relay.state.requests.filter((path) => path === `/drops/${OUTSIDE_ID}`).length - dropsBeforePreview === 1,
        relay.state.requests.slice(-5),
    );
    await page.keyboard.press('Escape');

    // 7. Relay down: the series page falls back to AniList's rate, no map, no app error.
    relay.state.isDown = true;
    await openSeries(SL.id);
    await page
        .getByText('3.2 % dropped')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    text = await blockText();
    check(
        label('relay down: "3.2 % dropped" from AniList, no map, no band (no index)'),
        text.includes('3.2 % dropped') && (await block.first().locator('[role="img"]').count()) === 0,
        { text },
    );

    check(label('no page errors'), pageErrors.length === 0, pageErrors);
    const appErrors = consoleErrors.filter(
        (message) => !/Failed to load resource|net::ERR_|Cross-Origin Request Blocked/.test(message),
    );
    check(label('no console errors from the app'), appErrors.length === 0, appErrors);
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
