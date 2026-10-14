/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the Similar row on the manga screen (production build, mocked Suwayomi, fixture AniList): a
// vertical wheel scrolls the row sideways and hands over to the page at the row's end, the edge arrows and the
// arrow keys page through it, "Show all" switches to a wrapped grid stored in global meta (shared by devices), and
// a touch screen gets the grid by default.
//
// Usage: pnpm build && node tools/scripts/tsuji/similar-scroll.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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
const REC_COUNT = 20;

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

/** Fixture AniList for Similar: the title search finds the seed, which has 20 recommendations. */
const answerAniList = ({ query }) => {
    const operation = query.match(/query\s+(\w+)/)?.[1];
    switch (operation) {
        case 'TsujiSearch':
            return {
                Page: {
                    media: [
                        {
                            id: SEED_ID,
                            title: {
                                romaji: 'Scroll Test',
                                english: 'Scroll Test',
                                native: null,
                                userPreferred: 'Scroll Test',
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
                        nodes: Array.from({ length: REC_COUNT }, (_, index) => ({
                            rating: 100 - index,
                            mediaRecommendation: media(100 + index),
                        })),
                    },
                },
            };
        case 'TsujiMyList':
            return { MediaListCollection: { lists: [] } };
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

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;

    const openContext = async (server, contextOptions) => {
        const context = await browser.newContext(contextOptions);
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
        return context;
    };

    const createServer = () =>
        createMockSuwayomi({
            manga: {
                id: MANGA_ID,
                title: 'Scroll Test',
                sourceId: '1',
                inLibrary: true,
                genre: [],
                source: { id: '1', name: 'Local source', displayName: 'Local source' },
            },
            // Enough chapters that the page itself can scroll below the Similar section.
            chapters: Array.from({ length: 40 }, (_, index) => ({
                id: 900 + index,
                mangaId: MANGA_ID,
                name: `Chapter ${index + 1}`,
                chapterNumber: index + 1,
                sourceOrder: index + 1,
                scanlator: null,
                isRead: false,
                isBookmarked: false,
                isDownloaded: false,
                lastPageRead: 0,
                pageCount: 1,
                uploadDate: '0',
                fetchedAt: '0',
                lastReadAt: '0',
                url: '',
            })).reverse(),
            pageCount: 1,
        });

    // Desktop with a mouse.
    const server = createServer();
    const context = await openContext(server, { viewport: { width: 1280, height: 900 } });
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
    const row = page.getByRole('group', { name: 'Similar titles' });
    await row.waitFor({ timeout: 20_000 }).catch(() => {});
    check(label('mouse: Similar opens as a row'), await row.isVisible(), {});

    // The app scrolls a container, not always the window: the row's top tells whether the page moved.
    const metrics = () =>
        row.evaluate((element) => ({
            scrollLeft: element.scrollLeft,
            max: element.scrollWidth - element.clientWidth,
            clientWidth: element.clientWidth,
            rowTop: Math.round(element.getBoundingClientRect().top),
        }));
    await row.scrollIntoViewIfNeeded();
    const box = await row.boundingBox();
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    const before = await metrics();
    await page.mouse.wheel(0, 200);
    await page.waitForTimeout(300);
    const afterWheel = await metrics();
    check(
        label('wheel down over the row scrolls it right, the page stays'),
        afterWheel.scrollLeft > before.scrollLeft + 100 && afterWheel.rowTop === before.rowTop,
        { before, afterWheel },
    );

    check(
        label('arrows: right shown, left shown after scrolling'),
        (await page.getByRole('button', { name: 'Scroll right' }).count()) === 1 &&
            (await page.getByRole('button', { name: 'Scroll left' }).count()) === 1,
        {},
    );

    for (let step = 0; step < 40; step += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await page.mouse.wheel(0, 400);
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(60);
    }
    await page.waitForTimeout(400);
    const atEnd = await metrics();
    check(
        label('right arrow hidden at the end'),
        (await page.getByRole('button', { name: 'Scroll right' }).count()) === 0,
        {},
    );
    // At the end the row must not take the wheel (no scroll trap): the event reaches the page uncancelled.
    // (The page itself may not scroll here: the mock manga screen is shorter than the window.)
    const isWheelTaken = (deltaY) =>
        row.evaluate((element, dy) => {
            const event = new WheelEvent('wheel', { deltaY: dy, cancelable: true, bubbles: true });
            element.dispatchEvent(event);
            return event.defaultPrevented;
        }, deltaY);
    const takenDownAtEnd = await isWheelTaken(100);
    const takenUpAtEnd = await isWheelTaken(-100);
    check(
        label('at the row end a further wheel down is left to the page; wheel up still moves the row'),
        atEnd.scrollLeft >= atEnd.max - 1 && !takenDownAtEnd && takenUpAtEnd,
        { atEnd, takenDownAtEnd, takenUpAtEnd },
    );

    const beforeKey = await metrics();
    await row.focus();
    await page.keyboard.press('ArrowLeft');
    await page.waitForTimeout(800);
    const afterKey = await metrics();
    check(
        label('ArrowLeft with the row focused pages back'),
        beforeKey.scrollLeft - afterKey.scrollLeft >= (afterKey.clientWidth - 140) * 0.9,
        {
            afterKey,
        },
    );

    await page.getByRole('button', { name: 'Show all' }).click();
    await page.waitForTimeout(800);
    check(
        label('Show all: wrapped grid, stored in global meta'),
        (await page.getByRole('group', { name: 'Similar titles' }).count()) === 0 &&
            server.meta.get('tsuji_similarLayout') === 'grid',
        { stored: server.meta.get('tsuji_similarLayout') },
    );
    await page.reload();
    await page
        .getByRole('button', { name: 'Show as row' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    check(
        label('the grid choice survives a reload'),
        await page.getByRole('button', { name: 'Show as row' }).isVisible(),
        {},
    );
    check(label('no page errors'), pageErrors.length === 0, pageErrors);
    await context.close();

    // A phone (touch, coarse pointer), nothing stored: grid by default, capped at 4 rows with More.
    const phoneServer = createServer();
    const phone = await openContext(phoneServer, {
        viewport: { width: 390, height: 844 },
        hasTouch: true,
        isMobile: browserName !== 'firefox',
    });
    const phonePage = await phone.newPage();
    await phonePage.goto(`${ORIGIN}/manga/${MANGA_ID}`);
    const showAsRow = phonePage.getByRole('button', { name: 'Show as row' });
    await showAsRow.waitFor({ timeout: 20_000 }).catch(() => {});
    await phonePage
        .getByText('Rec 100', { exact: true })
        .first()
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    const isCoarse = await phonePage.evaluate(() => window.matchMedia('(pointer: coarse)').matches);
    if (isCoarse) {
        check(label('touch: Similar opens as the grid by default'), await showAsRow.isVisible(), {});
        check(
            label('touch: grid capped, More reveals the rest'),
            (await phonePage.getByRole('button', { name: /^More \(\d+\)$/ }).count()) === 1,
            {
                buttons: await phonePage
                    .locator('button')
                    .evaluateAll((buttons) =>
                        buttons.map((button) => button.textContent).filter((text) => /More|Show/.test(text ?? '')),
                    ),
            },
        );
    } else {
        console.log(label('touch checks skipped: this browser reports no coarse pointer'));
    }
    await phone.close();
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
