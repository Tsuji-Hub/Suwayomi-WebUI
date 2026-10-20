/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the new-chapter bell (brief #10) on the production build against the mocked Suwayomi: entries only
// for caught-up series in ongoing / Completed (not Reading, not a backlog, not never-read, new copies of read
// chapters ignored), the first-run cap (newest 30 unseen), one bell query per load, a row opening the first new
// chapter and clearing its entry, Mark all seen, the state shared with a second browser, and the watched categories.
//
// Usage: pnpm build && node tools/scripts/tsuji/chapter-bell.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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

const CATEGORIES = [
    { id: 0, name: 'Default' },
    { id: 1, name: 'Reading' },
    { id: 2, name: 'ongoing' },
    { id: 3, name: 'Completed' },
];
const category = (name) => CATEGORIES.find((each) => each.name === name);

const NOW = Math.floor(Date.now() / 1000);
const HOUR = 3600;

/** [mangaId, title, category, highest read number, unread count, [[number, hours ago], ...]]. */
const SERIES = [
    [
        1,
        'Bell Main',
        'ongoing',
        10,
        2,
        [
            [11, 1],
            [12, 1],
        ],
    ],
    [2, 'Reading Series', 'Reading', 20, 1, [[21, 2]]],
    [3, 'Backlog Series', 'Completed', 30, 5, [[31, 3]]],
    [
        4,
        'Twin Copy',
        'Completed',
        50,
        2,
        [
            [50, 4],
            [51, 4],
        ],
    ],
    [5, 'Never Read', 'ongoing', null, 1, [[1, 5]]],
    // 33 more caught-up Completed series, older: the first run leaves only the newest 30 entries unseen.
    ...Array.from({ length: 33 }, (_, index) => [
        100 + index,
        `Completed ${String(index + 1).padStart(2, '0')}`,
        'Completed',
        5,
        1,
        [[6, 10 + index]],
    ]),
];

let chapterId = 9000;
const BELL_CHAPTERS = SERIES.flatMap(([mangaId, title, categoryName, highestRead, unreadCount, fresh]) => {
    const manga = {
        id: mangaId,
        title,
        thumbnailUrl: null,
        unreadCount,
        latestReadChapter: highestRead === null ? null : { id: mangaId * 1000, chapterNumber: highestRead },
        categories: { nodes: [category(categoryName)], totalCount: 1, pageInfo: {} },
    };
    return fresh.map(([chapterNumber, hoursAgo]) => ({
        id: chapterId++,
        mangaId,
        chapterNumber,
        sourceOrder: chapterNumber,
        fetchedAt: String(NOW - hoursAgo * HOUR),
        isRead: false,
        manga,
    }));
});

const connection = (nodes) => ({
    nodes,
    totalCount: nodes.length,
    pageInfo: { hasNextPage: false, hasPreviousPage: false },
});

// Bell Main's own chapters for the reader: 1-10 read, 11-12 new.
const MAIN_CHAPTERS = Array.from({ length: 12 }, (_, index) => {
    const number = index + 1;
    return {
        id: 7700 + number,
        mangaId: 1,
        name: `Chapter ${number}`,
        chapterNumber: number,
        sourceOrder: number,
        scanlator: null,
        isRead: number <= 10,
        isBookmarked: false,
        isDownloaded: false,
        lastPageRead: 0,
        pageCount: 2,
        uploadDate: '0',
        fetchedAt: String(NOW - (number > 10 ? HOUR : 100 * HOUR)),
        lastReadAt: '0',
        url: '',
    };
}).reverse();

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

// By attribute: an open panel hides the app bar from the accessibility tree.
const bellButton = (page) => page.locator('button[aria-label^="New chapters"]');

const rowTitles = (page) =>
    page
        .getByRole('list', { name: 'New chapters' })
        .locator('li')
        .evaluateAll((rows) => rows.map((row) => row.querySelector('p')?.textContent ?? ''));

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;
    const server = createMockSuwayomi({
        manga: {
            id: 1,
            title: 'Bell Main',
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local source', displayName: 'Local source' },
            chapters: { totalCount: MAIN_CHAPTERS.length },
            // The same series as the bell's copy (Apollo merges both into one cache entry, as on a real server).
            unreadCount: 2,
            latestReadChapter: { id: 7710, chapterNumber: 10 },
            categories: { nodes: [category('ongoing')], totalCount: 1, pageInfo: {} },
        },
        chapters: MAIN_CHAPTERS,
        pageCount: 2,
        handlers: {
            'Query.categories': () => connection(CATEGORIES),
            // Only the bell's query filters on fetchedAt; anything else gets the built-in chapters.
            'Query.chapters': ({ filter }) => (filter?.fetchedAt ? connection(BELL_CHAPTERS) : undefined),
        },
    });

    /** One browser context (a "browser" for the shared-state check), counting bell queries. */
    const openContext = async () => {
        const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
        const bellQueries = [];
        await context.route('**/*', async (route) => {
            const request = route.request();
            const url = new URL(request.url());
            if (url.origin !== ORIGIN) {
                return route.abort();
            }
            if (url.pathname.startsWith('/api/graphql')) {
                const body = request.postDataJSON();
                (Array.isArray(body) ? body : [body])
                    .filter(({ operationName }) => operationName === 'TSUJI_CHAPTER_BELL')
                    .forEach(() => bellQueries.push(Date.now()));
                const result = await server.handle(body);
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
        return { context, page, bellQueries, pageErrors };
    };

    const badgeCount = async (page) => {
        const name = await bellButton(page)
            .getAttribute('aria-label')
            .catch(() => '');
        return Number(name?.match(/: (\d+)/)?.[1] ?? 0);
    };
    const waitForCount = async (page, expected) => {
        for (let waited = 0; waited < 10_000; waited += 200) {
            // oxlint-disable-next-line no-await-in-loop
            if ((await badgeCount(page)) === expected) {
                return expected;
            }
            // oxlint-disable-next-line no-await-in-loop
            await page.waitForTimeout(200);
        }
        return badgeCount(page);
    };

    const first = await openContext();
    const { page } = first;
    await page.goto(`${ORIGIN}/library`);
    await bellButton(page).waitFor({ timeout: 15_000 });
    const firstCount = await waitForCount(page, 30);
    for (let waited = 0; !server.meta.get('tsuji_bellStart') && waited < 5000; waited += 200) {
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(200);
    }
    check(label('first run: the badge counts the newest 30 entries'), firstCount === 30, firstCount);
    check(
        label('first run is recorded (tsuji_bellStart) and the 5 oldest entries start seen'),
        !!server.meta.get('tsuji_bellStart') &&
            [...server.meta.keys()].some((key) => key.startsWith('tsuji_bell_')) &&
            ['128', '129', '130', '131', '132'].every((id) =>
                [...server.meta.entries()].some(
                    ([key, value]) => key.startsWith('tsuji_bell_') && value.includes(`"${id}"`),
                ),
            ),
        Object.fromEntries([...server.meta].filter(([key]) => key.startsWith('tsuji_bell'))),
    );
    check(label('page title prefixed with the count'), (await page.title()).startsWith('(30) '), await page.title());

    await bellButton(page).click();
    await page
        .getByRole('list', { name: 'New chapters' })
        .waitFor({ timeout: 5000 })
        .catch(() => {});
    const titles = await rowTitles(page);
    check(
        label('entries: caught-up ongoing / Completed only, newest first (not Reading, backlog, never read)'),
        titles[0] === 'Bell Main' &&
            titles[1] === 'Twin Copy' &&
            !['Reading Series', 'Backlog Series', 'Never Read'].some((title) => titles.includes(title)) &&
            titles.length === 30,
        titles.slice(0, 5),
    );
    const panelText = await page
        .getByRole('list', { name: 'New chapters' })
        .innerText()
        .catch(() => '');
    check(
        label('rows: category chip, "Ch 11-12 · 2 new"; a new copy of a read chapter is ignored ("Ch 51")'),
        panelText.includes('Ch 11-12 · 2 new') &&
            panelText.includes('ongoing') &&
            panelText.includes('Ch 51') &&
            !panelText.includes('Ch 50-51'),
        panelText.slice(0, 200),
    );

    await page.getByRole('button', { name: /^Bell Main/ }).click();
    await page.waitForURL(/\/manga\/1\/chapter\/11/, { timeout: 10_000 }).catch(() => {});
    check(
        label('a row opens the first new chapter in the reader'),
        /\/manga\/1\/chapter\/11/.test(page.url()),
        page.url(),
    );
    await page.goto(`${ORIGIN}/library`);
    const afterOpen = await waitForCount(page, 29);
    check(label('the opened entry is seen: count 29'), afterOpen === 29, afterOpen);
    check(label('one bell query per page load'), first.bellQueries.length === 2, first.bellQueries.length);

    const second = await openContext();
    await second.page.goto(`${ORIGIN}/library`);
    await bellButton(second.page).waitFor({ timeout: 15_000 });
    const secondCount = await waitForCount(second.page, 29);
    check(label('a second browser sees the same state'), secondCount === 29, secondCount);

    await bellButton(page).click();
    await page.getByRole('button', { name: 'Mark all seen' }).click();
    const cleared = await waitForCount(page, 0);
    check(
        label('Mark all seen clears the badge and the title prefix'),
        cleared === 0 && !(await page.title()).startsWith('('),
        { cleared, title: await page.title() },
    );
    await second.page.reload();
    await bellButton(second.page).waitFor({ timeout: 15_000 });
    await second.page.waitForTimeout(1500);
    check(
        label('the second browser is cleared after a reload'),
        (await badgeCount(second.page)) === 0,
        await badgeCount(second.page),
    );

    // Watched categories: add Reading.
    await page.getByRole('button', { name: 'Bell settings' }).click();
    await page.getByRole('checkbox', { name: 'Reading' }).check();
    await page.getByRole('button', { name: 'Save' }).click();
    const withReading = await waitForCount(page, 1);
    check(
        label('watching Reading adds its caught-up series'),
        withReading === 1 && server.meta.get('tsuji_bellCategories') === '[1,2,3]',
        { withReading, saved: server.meta.get('tsuji_bellCategories') },
    );

    check(label('no page errors'), !first.pageErrors.length && !second.pageErrors.length, [
        ...first.pageErrors,
        ...second.pageErrors,
    ]);
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
