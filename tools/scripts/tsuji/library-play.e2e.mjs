/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the library card's Play button (library Play brief) on the production build: it opens the chapter
// the series page's Resume opens (twins, the read scanlator, excluded scanlators), not the server's first unread copy.
// Shaped like The Millionaire Divorcee (/manga/10876, r3461): ch 86 read in both copies, ch 87 in neither, read
// scanlator "unofficial"; the server's firstUnreadChapter is ch 87 official (174), Resume is ch 87 unofficial (175).
// The chapter list is asked for on hover only (none with the library), once per title.
//
// Usage: pnpm build && node tools/scripts/tsuji/library-play.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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

const TWINS_ID = 10_876;
const PLAIN_ID = 20;
/** Every chapter number has a read copy (the server still lists the other copy as unread): opens the series. */
const CAUGHT_ID = 30;
/** Its chapter list fails: the server's first unread chapter, as before. */
const BROKEN_ID = 40;

const chapter = (mangaId, id, sourceOrder, chapterNumber, scanlator, isRead) => ({
    id,
    mangaId,
    name: `Chapter ${chapterNumber}`,
    chapterNumber,
    sourceOrder,
    scanlator,
    isRead,
    isBookmarked: false,
    isDownloaded: false,
    lastPageRead: 0,
    pageCount: 10,
    uploadDate: '0',
    fetchedAt: '0',
    lastReadAt: '0',
    url: '',
});

/** Latest first, like the server's default order. */
const TWIN_CHAPTERS = [
    chapter(TWINS_ID, 875, 175, 87, 'unofficial', false),
    chapter(TWINS_ID, 874, 174, 87, 'Official', false),
    chapter(TWINS_ID, 873, 173, 86, 'unofficial', true),
    chapter(TWINS_ID, 872, 172, 86, 'Official', true),
];
const PLAIN_CHAPTERS = [
    chapter(PLAIN_ID, 203, 3, 3, 'Group', false),
    chapter(PLAIN_ID, 202, 2, 2, 'Group', false),
    chapter(PLAIN_ID, 201, 1, 1, 'Group', true),
];

const CAUGHT_CHAPTERS = [chapter(CAUGHT_ID, 302, 2, 1, 'B', false), chapter(CAUGHT_ID, 301, 1, 1, 'A', true)];
const BROKEN_CHAPTERS = [chapter(BROKEN_ID, 402, 2, 2, 'Group', false), chapter(BROKEN_ID, 401, 1, 1, 'Group', true)];

const libraryManga = (id, title, chapters, firstUnread) => ({
    id,
    title,
    sourceId: '1',
    inLibrary: true,
    genre: [],
    unreadCount: chapters.filter(({ isRead }) => !isRead).length,
    downloadCount: 0,
    source: { id: '1', name: 'Local source', displayName: 'Local source' },
    chapters: { totalCount: chapters.length },
    trackRecords: { totalCount: 0, nodes: [] },
    firstUnreadChapter: { ...firstUnread },
});

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
    const twins = libraryManga(TWINS_ID, 'The Millionaire Divorcee', TWIN_CHAPTERS, TWIN_CHAPTERS[1]);
    const plain = libraryManga(PLAIN_ID, 'Plain Series', PLAIN_CHAPTERS, PLAIN_CHAPTERS[1]);
    const caught = libraryManga(CAUGHT_ID, 'Caught Up Series', CAUGHT_CHAPTERS, CAUGHT_CHAPTERS[0]);
    const broken = libraryManga(BROKEN_ID, 'Broken List Series', BROKEN_CHAPTERS, BROKEN_CHAPTERS[0]);
    const library = [twins, plain, caught, broken];
    const listOf = () => ({
        nodes: library,
        totalCount: library.length,
        pageInfo: { hasNextPage: false, hasPreviousPage: false },
    });
    const category = () => ({ id: 0, name: 'Default', order: 0, default: true, meta: [], mangas: listOf() });
    const server = createMockSuwayomi({
        manga: twins,
        chapters: TWIN_CHAPTERS,
        pageCount: 10,
        extraMangas: [
            { manga: plain, chapters: PLAIN_CHAPTERS, pageCount: 10 },
            { manga: caught, chapters: CAUGHT_CHAPTERS, pageCount: 10 },
            { manga: broken, chapters: BROKEN_CHAPTERS, pageCount: 10 },
        ],
        globalMeta: { webUI_showContinueReadingButton: 'true' },
        handlers: {
            'Query.categories': () => ({
                nodes: [category()],
                totalCount: 1,
                pageInfo: { hasNextPage: false, hasPreviousPage: false },
            }),
            'Query.category': category,
            'Query.mangas': listOf,
            'Query.chapters': ({ condition }) => {
                if (condition?.mangaId === BROKEN_ID) {
                    throw new Error('chapter list unavailable');
                }
                return undefined;
            },
        },
    });
    server.mangaMeta.set('tsuji_readScanlator', JSON.stringify('unofficial'));

    const operations = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== ORIGIN) {
            return route.abort();
        }
        if (url.pathname.startsWith('/api/graphql')) {
            const body = request.postDataJSON();
            operations.push({ name: body.operationName, variables: body.variables });
            const result = await server.handle(body);
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
    await page.goto(`${ORIGIN}/library`);
    const twinsPlay = page.locator(`a[href^="/manga/${TWINS_ID}/chapter/"]`).first();
    await twinsPlay.waitFor({ timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(1000);
    const chapterQueries = (mangaId) =>
        operations.filter(
            ({ name, variables }) => name === 'GET_CHAPTERS_MANGA' && variables?.condition?.mangaId === mangaId,
        ).length;
    check(
        label('library load: the Play buttons, no chapter list asked for'),
        (await twinsPlay.count()) === 1 && operations.every(({ name }) => name !== 'GET_CHAPTERS_MANGA'),
        operations.map(({ name }) => name),
    );

    await twinsPlay.hover();
    const tooltip = page.getByRole('tooltip');
    await page
        .waitForFunction((id) => document.querySelector(`a[href="/manga/${id}/chapter/175"]`) !== null, TWINS_ID, {
            timeout: 10_000,
        })
        .catch(() => {});
    await page.waitForTimeout(500);
    const tooltipText = await tooltip.innerText().catch(() => '');
    check(
        label('hover: resolved to ch 87 unofficial (175), the tooltip says unofficial; one chapter query'),
        (await page.locator(`a[href="/manga/${TWINS_ID}/chapter/175"]`).count()) === 1 &&
            /unofficial/.test(tooltipText) &&
            chapterQueries(TWINS_ID) === 1,
        { tooltipText, queries: chapterQueries(TWINS_ID) },
    );
    await page.mouse.move(0, 0);
    await page.locator(`a[href="/manga/${TWINS_ID}/chapter/175"]`).hover();
    await page.waitForTimeout(500);
    check(
        label('hover again: no second chapter query (cache-first)'),
        chapterQueries(TWINS_ID) === 1,
        chapterQueries(TWINS_ID),
    );
    await page.locator(`a[href="/manga/${TWINS_ID}/chapter/175"]`).click();
    await page.waitForURL(`**/manga/${TWINS_ID}/chapter/175`, { timeout: 10_000 }).catch(() => {});
    check(
        label('click opens ch 87 unofficial (sourceOrder 175), like the series page Resume'),
        new URL(page.url()).pathname === `/manga/${TWINS_ID}/chapter/175`,
        page.url(),
    );

    // A title without twins: a click without a hover first (the spinner path) opens the same chapter as before.
    await page.goto(`${ORIGIN}/library`);
    const plainPlay = page.locator(`a[href^="/manga/${PLAIN_ID}/chapter/"]`).first();
    await plainPlay.waitFor({ timeout: 20_000 }).catch(() => {});
    const plainBefore = await plainPlay.getAttribute('href').catch(() => null);
    await plainPlay.dispatchEvent('click', { button: 0 });
    await page.waitForURL(`**/manga/${PLAIN_ID}/chapter/2`, { timeout: 10_000 }).catch(() => {});
    check(
        label('no twins: a straight click opens ch 2 (sourceOrder 2), as before'),
        plainBefore === `/manga/${PLAIN_ID}/chapter/2` &&
            new URL(page.url()).pathname === `/manga/${PLAIN_ID}/chapter/2` &&
            chapterQueries(PLAIN_ID) === 1,
        { plainBefore, url: page.url(), queries: chapterQueries(PLAIN_ID) },
    );

    // Every chapter number read in some copy: the series page, not a reader.
    await page.goto(`${ORIGIN}/library`);
    const caughtPlay = page.locator(`a[href^="/manga/${CAUGHT_ID}/chapter/"]`).first();
    await caughtPlay.waitFor({ timeout: 20_000 }).catch(() => {});
    await caughtPlay.hover();
    // The Play button itself (the card links to the series too).
    const caughtButton = page.locator(`a.MuiButton-root[href="/manga/${CAUGHT_ID}"]`);
    await caughtButton.waitFor({ timeout: 10_000 }).catch(() => {});
    await caughtButton.hover();
    const caughtTooltipBox = page.getByRole('tooltip').filter({ hasText: 'open the series' });
    await caughtTooltipBox.waitFor({ timeout: 5000 }).catch(() => {});
    const caughtTooltip = await caughtTooltipBox.innerText().catch(() => '');
    await caughtButton.click();
    await page.waitForURL(`**/manga/${CAUGHT_ID}`, { timeout: 10_000 }).catch(() => {});
    check(
        label('every chapter read in some copy: the button opens the series page'),
        new URL(page.url()).pathname === `/manga/${CAUGHT_ID}` && /open the series/.test(caughtTooltip),
        { url: page.url(), caughtTooltip },
    );

    // The chapter list fails: the server's first unread chapter, as before.
    await page.goto(`${ORIGIN}/library`);
    const brokenPlay = page.locator(`a[href^="/manga/${BROKEN_ID}/chapter/"]`).first();
    await brokenPlay.waitFor({ timeout: 20_000 }).catch(() => {});
    await brokenPlay.dispatchEvent('click', { button: 0 });
    await page.waitForURL(`**/manga/${BROKEN_ID}/chapter/2`, { timeout: 10_000 }).catch(() => {});
    check(
        label("chapter list error: the server's first unread chapter (ch 2)"),
        new URL(page.url()).pathname === `/manga/${BROKEN_ID}/chapter/2` && chapterQueries(BROKEN_ID) >= 1,
        { url: page.url(), queries: chapterQueries(BROKEN_ID) },
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
