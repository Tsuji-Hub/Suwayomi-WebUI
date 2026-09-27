/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the webtoon resume on a hard reload, through the real route entry: loads the production build
// (build/, or BUILD_DIR) at /manga/450/chapter/1 with no navigation state, like typing the URL or pressing F5,
// against an in-memory Suwayomi (tools/scripts/tsuji/mockSuwayomi.mjs). Page images load slowly, in order, so the pages above
// the target have no height when the reader first scrolls.
//
// Usage: pnpm build && pnpm test:tsuji:e2e
// Browser: CHROMIUM_PATH, else Playwright's bundled Chromium (/opt/pw-browsers), else the installed Chrome.
// E2E_BROWSERS=chrome,firefox also runs the saving and F5 scenarios in Playwright's Firefox (install it first with
// `pnpm exec playwright-core install firefox`).

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const MANGA_ID = 450;
const CHAPTER_ID = 52950;
const PAGE_COUNT = 10;
const LAST_PAGE_READ = 4;
const OFFSET = 0.1316;
const PAGE_SIZE = { width: 720, height: 1400 };
const IMAGE_DELAY_MS = 250;
const WEBTOON = '4'; // ReadingMode.WEBTOON

const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
        c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    return c >>> 0;
});
const crc32 = (buffer) => {
    let c = 0xffffffff;
    buffer.forEach((byte) => {
        c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
    });
    return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
};
/** Solid-color RGB PNG. */
const png = (width, height, [r, g, b]) => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const row = Buffer.alloc(1 + width * 3);
    for (let x = 0; x < width; x += 1) {
        row.set([r, g, b], 1 + x * 3);
    }
    const raw = Buffer.concat(Array.from({ length: height }, () => row));
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(raw)),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};
const pageImages = Array.from({ length: PAGE_COUNT }, (_, index) =>
    png(PAGE_SIZE.width, PAGE_SIZE.height, [40 + index * 20, 90, 160 - index * 10]),
);

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

const createServer = ({ genre = [], globalMeta = { webUI_readingMode: WEBTOON } } = {}) => {
    const manga = {
        id: MANGA_ID,
        title: 'Resume Test',
        sourceId: '1',
        inLibrary: true,
        genre,
        source: { id: '1', name: 'Local source', displayName: 'Local source' },
        chapters: { totalCount: 1 },
    };
    const chapter = {
        id: CHAPTER_ID,
        mangaId: MANGA_ID,
        name: 'Chapter 1',
        chapterNumber: 1,
        sourceOrder: 1,
        isRead: false,
        isBookmarked: false,
        isDownloaded: false,
        lastPageRead: LAST_PAGE_READ,
        pageCount: PAGE_COUNT,
        uploadDate: '0',
        fetchedAt: '0',
        lastReadAt: '0',
        url: '',
    };
    return createMockSuwayomi({
        manga,
        chapters: [chapter],
        pageCount: PAGE_COUNT,
        globalMeta,
    });
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

const launch = () => {
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
};

/** Serves the build and an in-memory Suwayomi to the context; page `index` arrives after `imageDelayMs(index)`. */
const routeMockSuwayomi = async (context, server, { images, imageDelayMs, requestedPages = new Set() }) => {
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) {
            return route.abort();
        }
        if (url.pathname.startsWith('/api/graphql')) {
            const result = await server.handle(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
        }
        const pageMatch = url.pathname.match(/\/chapter\/\d+\/page\/(\d+)$/);
        if (pageMatch) {
            const index = Number(pageMatch[1]);
            requestedPages.add(index);
            await new Promise((done) => {
                setTimeout(done, imageDelayMs(index));
            });
            return route.fulfill({ status: 200, contentType: 'image/png', body: images[index] });
        }
        if (url.pathname.startsWith('/api/')) {
            return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill(serveFile(url.pathname));
    });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
};

const measure = (page, pageIndex = LAST_PAGE_READ) =>
    page.evaluate((index) => {
        const image = document.querySelector(`img[alt="Page #${index + 1}"]`);
        const scroller = image
            ? (() => {
                  let element = image.parentElement;
                  while (
                      element &&
                      !(
                          element.scrollHeight > element.clientHeight + 1 &&
                          getComputedStyle(element).overflowY === 'auto'
                      )
                  ) {
                      element = element.parentElement;
                  }
                  return element;
              })()
            : null;
        if (!image || !scroller) {
            return null;
        }
        const imageRect = image.getBoundingClientRect();
        const top = imageRect.top - scroller.getBoundingClientRect().top + scroller.scrollTop;
        return { scrollTop: scroller.scrollTop, pageTop: top, pageHeight: imageRect.height };
    }, pageIndex);

/** `E2E_ONLY=<part of a scenario name>` runs just the matching scenarios. */
const isSelected = (name) => !process.env.E2E_ONLY || name.includes(process.env.E2E_ONLY);

const failures = [];
const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(detail)}`);
    if (!ok) {
        failures.push(label);
    }
};

/**
 * One fresh browser context (empty cache, saved offset in localStorage, server lastPageRead = 4): direct URL load,
 * then F5, then a wheel scroll. `imageDelayMs(index)` is how long page `index` takes to arrive.
 */
const runScenario = async (browser, name, { imageDelayMs, viewport, serverOptions, onLoadStart }) => {
    if (!isSelected(name)) {
        return;
    }
    const server = createServer(serverOptions);
    const context = await browser.newContext({ viewport });
    const requestedPages = new Set();

    await routeMockSuwayomi(context, server, { images: pageImages, imageDelayMs, requestedPages });
    await context.addInitScript(
        ([chapterId, pageIndex, offset]) => {
            if (!localStorage.getItem('tsuji_readerPageOffsets')) {
                localStorage.setItem(
                    'tsuji_readerPageOffsets',
                    JSON.stringify({ [`c${chapterId}`]: [pageIndex, offset] }),
                );
            }
        },
        [CHAPTER_ID, LAST_PAGE_READ, OFFSET],
    );

    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`[${name}] pageerror:`, error.message));

    const checkPosition = async (label) => {
        const m = await measure(page);
        const expected = m ? Math.round(m.pageTop + m.pageHeight * OFFSET) : null;
        // The target must be the loaded image (real height), else the offset check would be trivially true.
        const hasRealHeight = !!m && m.pageHeight > 100;
        check(
            `[${name}] ${label}: scrollTop is page ${LAST_PAGE_READ} + ${OFFSET} of its real height`,
            hasRealHeight && Math.abs(m.scrollTop - expected) <= 2,
            { ...m, expected },
        );
    };

    const waitForTarget = () =>
        page.waitForFunction(
            (index) => {
                const image = document.querySelector(`img[alt="Page #${index + 1}"]`);
                return !!image && image.complete && image.naturalHeight > 0 && image.getBoundingClientRect().height > 0;
            },
            LAST_PAGE_READ,
            { timeout: 20_000, polling: 100 },
        );

    const verifyResume = async (label, { beforeTargetLoads } = {}) => {
        await beforeTargetLoads?.();
        await waitForTarget();
        await page.waitForTimeout(500);
        await checkPosition(`${label}, target loaded`);
        await page.waitForTimeout(8000);
        await checkPosition(`${label}, 8 s later`);
        const lowest = Math.min(
            ...server.chapterWrites
                .filter((write) => write.lastPageRead !== undefined)
                .map((write) => write.lastPageRead),
        );
        check(`[${name}] ${label}: no lastPageRead below ${LAST_PAGE_READ} written`, !(lowest < LAST_PAGE_READ), {
            writes: server.chapterWrites,
        });
    };

    // Direct URL load: no navigation state, like a bookmark or typing the address.
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/1`);
    await verifyResume('direct load', { beforeTargetLoads: onLoadStart && (() => onLoadStart(page)) });

    // Hard reload of that tab (F5).
    await page.reload();
    await verifyResume('reload', { beforeTargetLoads: onLoadStart && (() => onLoadStart(page)) });

    const abovePlaceholders = await page.evaluate(
        (target) =>
            Array.from({ length: target }, (_, index) =>
                document.querySelector(`img[alt="Page #${index + 1}"]`),
            ).filter(
                (image) =>
                    image && image.complete && image.naturalHeight > 0 && image.getBoundingClientRect().height > 0,
            ).length,
        LAST_PAGE_READ,
    );
    console.log(
        `[${name}] pages above the target shown as loaded images: ${abovePlaceholders} of ${LAST_PAGE_READ}; requested pages: ${[...requestedPages].sort((a, b) => a - b).join(',')}`,
    );

    // The user takes over: a wheel scroll up must not be pulled back.
    const before = await measure(page);
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(800);
    const after = await measure(page);
    check(`[${name}] wheel releases the pin`, !!after && after.scrollTop < before.scrollTop - 300, {
        before: before?.scrollTop,
        after: after?.scrollTop,
    });

    await context.close();
};

/*
 * The owner's live repro: read into a page with the mouse wheel, then F5. Shaped like the owner's setup: chapter 3 of
 * 5 (chapters before and after it), 60 pages of two heights, a 957 px viewport (the transition spacer above page 0 is
 * one viewport high) and the owner's webtoon settings (reader width 43 %, stretched pages).
 */
const LIVE_CHAPTER_ID = 52952;
const LIVE_SOURCE_ORDER = 3;
const LIVE_PAGE_COUNT = 60;
const LIVE_VIEWPORT = { width: 1280, height: 957 };
const LIVE_GLOBAL_META = {
    webUI_readingMode: WEBTOON,
    webUI_4_pageScaleMode: '0',
    webUI_4_readerWidth: JSON.stringify({ value: 43, enabled: true }),
    webUI_4_shouldStretchPage: 'true',
};
const livePageImages = Array.from({ length: LIVE_PAGE_COUNT }, (_, index) =>
    png(300, index % 3 === 0 ? 560 : 400, [60 + (index % 10) * 15, 100, 150]),
);
/** Where the wheel stops: inside page 3, a bit below its top (the owner's case saved [3, 0.2875]). */
const WHEEL_PAGE = 3;
const WHEEL_FRACTION = 0.3;
const TOLERANCE_PX = 50;
const ROUTE_STATE_START = { resumeMode: 0 }; // ReaderResumeMode.START
const ROUTE_STATE_LAST_READ = { resumeMode: 2 }; // ReaderResumeMode.LAST_READ

const createLiveServer = () => {
    const manga = {
        id: MANGA_ID,
        title: 'Resume Test',
        sourceId: '1',
        inLibrary: true,
        genre: ['Manhua'],
        source: { id: '1', name: 'Local source', displayName: 'Local source' },
        chapters: { totalCount: 5 },
    };
    // Newest first, like the server's chapter list.
    const chapters = [5, 4, 3, 2, 1].map((sourceOrder) => ({
        id: LIVE_CHAPTER_ID - LIVE_SOURCE_ORDER + sourceOrder,
        mangaId: MANGA_ID,
        name: `Chapter ${sourceOrder}`,
        chapterNumber: sourceOrder,
        sourceOrder,
        isRead: sourceOrder < LIVE_SOURCE_ORDER,
        isBookmarked: false,
        isDownloaded: false,
        lastPageRead: sourceOrder < LIVE_SOURCE_ORDER ? LIVE_PAGE_COUNT - 1 : 0,
        pageCount: LIVE_PAGE_COUNT,
        uploadDate: '0',
        fetchedAt: '0',
        lastReadAt: '0',
        url: '',
    }));
    return createMockSuwayomi({ manga, chapters, pageCount: LIVE_PAGE_COUNT, globalMeta: LIVE_GLOBAL_META });
};

const readStoredOffset = (page) =>
    page.evaluate(
        (id) => JSON.parse(localStorage.getItem('tsuji_readerPageOffsets') ?? '{}')[`c${id}`] ?? null,
        LIVE_CHAPTER_ID,
    );

const waitForPageImage = (page, index) =>
    page.waitForFunction(
        (i) => {
            const image = document.querySelector(`img[alt="Page #${i + 1}"]`);
            return !!image && image.complete && image.naturalHeight > 0 && image.getBoundingClientRect().height > 0;
        },
        index,
        { timeout: 20_000, polling: 100 },
    );

/** Real wheel events (no scrollTop writes) until the viewport top sits WHEEL_FRACTION into WHEEL_PAGE. */
const wheelIntoPage = async (page) => {
    await page.mouse.move(LIVE_VIEWPORT.width / 2, LIVE_VIEWPORT.height / 2);
    for (let step = 0; step < 80; step += 1) {
        // oxlint-disable-next-line no-await-in-loop
        const m = await measure(page, WHEEL_PAGE);
        const delta = Math.round(m.pageTop + m.pageHeight * WHEEL_FRACTION - m.scrollTop);
        if (Math.abs(delta) <= 2) {
            return;
        }
        // oxlint-disable-next-line no-await-in-loop
        await page.mouse.wheel(0, Math.max(-300, Math.min(300, delta)));
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(120);
    }
};

/**
 * Direct load of chapter 3 (lastPageRead 0), wheel into page 3, then F5 with `routeState` in the history entry: the
 * state an in-app open leaves there (chapter list, Continue, the reader's own chapter navigation), which the browser
 * keeps across a reload. After the reload the reader must sit on the saved spot (within TOLERANCE_PX), stay there, and
 * keep the saved offset until the user scrolls again.
 */
const runWheelReloadScenario = async (browser, name, { routeState, clearOffsetBeforeReload = false }) => {
    if (!isSelected(name)) {
        return;
    }
    const server = createLiveServer();
    const context = await browser.newContext({ viewport: LIVE_VIEWPORT });
    await routeMockSuwayomi(context, server, { images: livePageImages, imageDelayMs: () => 30 });
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`[${name}] pageerror:`, error.message));

    await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/${LIVE_SOURCE_ORDER}`);
    await waitForPageImage(page, WHEEL_PAGE);
    await page.waitForTimeout(1000);
    await wheelIntoPage(page);
    // The offset save and upstream's lastPageRead write (debounced) land.
    await page.waitForTimeout(2500);

    const saved = await readStoredOffset(page);
    const serverPage = server.chapters.get(LIVE_CHAPTER_ID).lastPageRead;
    check(`[${name}] wheel saved an offset inside page ${WHEEL_PAGE}`, !!saved && saved[0] === WHEEL_PAGE, {
        saved,
        serverLastPageRead: serverPage,
    });
    if (!saved) {
        await context.close();
        return;
    }

    if (routeState) {
        await page.evaluate((usr) => window.history.replaceState({ ...window.history.state, usr }, ''), routeState);
    }
    if (clearOffsetBeforeReload) {
        await page.evaluate(() => localStorage.removeItem('tsuji_readerPageOffsets'));
    }
    const writesBeforeReload = server.chapterWrites.length;
    const [targetPage, targetFraction] = clearOffsetBeforeReload ? [serverPage, 0] : saved;

    await page.reload();
    await waitForPageImage(page, targetPage);

    const checkSpot = async (label) => {
        const m = await measure(page, targetPage);
        const expected = m ? Math.round(m.pageTop + m.pageHeight * targetFraction) : null;
        check(
            `[${name}] ${label}: scrollTop within ${TOLERANCE_PX} px of page ${targetPage} + ${targetFraction}`,
            !!m && m.pageHeight > 100 && Math.abs(m.scrollTop - expected) <= TOLERANCE_PX,
            { ...m, expected },
        );
    };
    await page.waitForTimeout(1000);
    await checkSpot('after F5');
    await page.waitForTimeout(3000);
    await checkSpot('4 s after F5');

    if (!clearOffsetBeforeReload) {
        const kept = await readStoredOffset(page);
        check(`[${name}] saved offset kept through the reload`, JSON.stringify(kept) === JSON.stringify(saved), {
            saved,
            kept,
        });
    }
    // F5 again without touching anything: still a reload of the chapter being read.
    await page.reload();
    await waitForPageImage(page, targetPage);
    await page.waitForTimeout(1000);
    await checkSpot('second F5 without scrolling');

    const lowerWrites = server.chapterWrites
        .slice(writesBeforeReload)
        .filter((write) => write.ids.map(Number).includes(LIVE_CHAPTER_ID) && write.lastPageRead < targetPage);
    check(`[${name}] no lastPageRead below ${targetPage} written after F5`, lowerWrites.length === 0, { lowerWrites });

    // The user reads on: the saver follows again.
    await page.mouse.move(LIVE_VIEWPORT.width / 2, LIVE_VIEWPORT.height / 2);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(1000);
    const moved = await readStoredOffset(page);
    check(`[${name}] offset saved again after the user scrolls`, JSON.stringify(moved) !== JSON.stringify(saved), {
        saved,
        moved,
    });

    await context.close();
};

/** Scrolls the reader by script: no wheel, touch, pointer or key event (like a scrollbar drag or assistive tech). */
const scrollWithoutInputEvents = (page, dy) =>
    page.evaluate((delta) => {
        let element = document.querySelector('img[alt^="Page #"]')?.parentElement ?? null;
        while (element && getComputedStyle(element).overflowY !== 'auto') {
            element = element.parentElement;
        }
        element?.scrollBy(0, delta);
    }, dy);

/**
 * The saved offset has to follow the view however the user scrolls, not only land right after F5. Live, r3388 never
 * saved (the stored spot stayed at an old [0, 0]) while every landing check passed. Each step scrolls one way, then
 * checks that the stored [page, fraction] points at the viewport top; the reader's own first scroll must not
 * overwrite the old spot.
 */
const runSaveFollowsScrollScenario = async (browser, name) => {
    if (!isSelected(name)) {
        return;
    }
    const OLD_SPOT = [7, 0.5];
    const server = createLiveServer();
    const context = await browser.newContext({ viewport: LIVE_VIEWPORT });
    await routeMockSuwayomi(context, server, { images: livePageImages, imageDelayMs: () => 30 });
    await context.addInitScript(
        ([id, spot]) => {
            if (!sessionStorage.getItem('e2e-seeded')) {
                localStorage.setItem('tsuji_readerPageOffsets', JSON.stringify({ [`c${id}`]: spot }));
                sessionStorage.setItem('e2e-seeded', '1');
            }
        },
        [LIVE_CHAPTER_ID, OLD_SPOT],
    );
    const page = await context.newPage();
    page.on('pageerror', (error) => console.log(`[${name}] pageerror:`, error.message));

    const checkStoredFollowsView = async (label, before) => {
        await page.waitForTimeout(600);
        const stored = await readStoredOffset(page);
        const m = stored ? await measure(page, stored[0]) : null;
        const expected = m ? Math.round(m.pageTop + m.pageHeight * stored[1]) : null;
        check(
            `[${name}] ${label}: the stored offset points at the viewport top`,
            !!m &&
                m.pageHeight > 100 &&
                Math.abs(m.scrollTop - expected) <= TOLERANCE_PX &&
                (before === undefined || m.scrollTop !== before),
            { stored, scrollTop: m?.scrollTop, before, expected },
        );
        return m?.scrollTop;
    };
    const viewTop = async () => (await measure(page, 0))?.scrollTop;

    // lastPageRead 0: upstream scrolls to the top of page 0 by itself.
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/${LIVE_SOURCE_ORDER}`);
    await waitForPageImage(page, 2);
    await page.waitForTimeout(1500);
    const kept = await readStoredOffset(page);
    check(
        `[${name}] the reader's own first scroll keeps the old spot`,
        JSON.stringify(kept) === JSON.stringify(OLD_SPOT),
        {
            kept,
        },
    );

    let top = await viewTop();
    await scrollWithoutInputEvents(page, 1250);
    top = await checkStoredFollowsView('scroll without wheel/touch/pointer/key events', top);

    await page.mouse.move(LIVE_VIEWPORT.width / 2, LIVE_VIEWPORT.height / 2);
    await page.mouse.wheel(0, 700);
    top = await checkStoredFollowsView('wheel', top);

    await page.keyboard.press('ArrowDown');
    top = await checkStoredFollowsView('arrow key', top);

    await scrollWithoutInputEvents(page, 450);
    await checkStoredFollowsView('scroll without input events after reading', top);
    const readout = await page.evaluate(() => structuredClone(window.tsujiReaderResume ?? null));
    check(`[${name}] readout: saves counted, none failed`, !!readout && readout.saved > 0 && readout.failed === 0, {
        readout,
    });

    const reloadAndCheck = async (label) => {
        const [savedPage, savedFraction] = (await readStoredOffset(page)) ?? [0, 0];
        const serverPage = server.chapters.get(LIVE_CHAPTER_ID).lastPageRead;
        await page.reload();
        await waitForPageImage(page, savedPage);
        await page.waitForTimeout(1500);
        const m = await measure(page, savedPage);
        const expected = m ? Math.round(m.pageTop + m.pageHeight * savedFraction) : null;
        check(`[${name}] ${label}: lands on the saved spot`, !!m && Math.abs(m.scrollTop - expected) <= TOLERANCE_PX, {
            ...m,
            expected,
            saved: [savedPage, savedFraction],
            serverLastPageRead: serverPage,
        });
    };

    // Upstream writes lastPageRead 1 s after a page change: F5 right after scrolling into the next page.
    await page.waitForTimeout(1500);
    await page.mouse.move(LIVE_VIEWPORT.width / 2, LIVE_VIEWPORT.height / 2);
    await page.mouse.wheel(0, 500);
    await page.waitForTimeout(300);
    await reloadAndCheck('F5 0.3 s after scrolling into the next page');

    // And once lastPageRead has landed.
    await page.mouse.move(LIVE_VIEWPORT.width / 2, LIVE_VIEWPORT.height / 2);
    await page.mouse.wheel(0, 250);
    await page.waitForTimeout(2500);
    await reloadAndCheck('F5 after lastPageRead is written');

    await context.close();
};

const launchFirefox = () => firefox.launch();

const run = async () => {
    const browserNames = (process.env.E2E_BROWSERS ?? 'chrome').split(',').map((browserName) => browserName.trim());
    if (browserNames.includes('firefox')) {
        // The owner reads in Firefox: the saving and F5 paths again in Gecko.
        const firefoxBrowser = await launchFirefox();
        await runSaveFollowsScrollScenario(firefoxBrowser, 'firefox: saves follow every kind of scroll');
        await runWheelReloadScenario(firefoxBrowser, 'firefox: wheel then F5, opened in-app with START', {
            routeState: ROUTE_STATE_START,
        });
        await firefoxBrowser.close();
    }
    if (browserNames.includes('chrome')) {
        const browser = await launch();

        await runSaveFollowsScrollScenario(browser, 'saves follow every kind of scroll');

        // Read with the wheel, then F5: the owner's live repro. The history entry keeps the route state of the in-app open.
        await runWheelReloadScenario(browser, 'wheel then F5, opened in-app with START', {
            routeState: ROUTE_STATE_START,
        });
        await runWheelReloadScenario(browser, 'wheel then F5, opened in-app with LAST_READ', {
            routeState: ROUTE_STATE_LAST_READ,
        });
        await runWheelReloadScenario(browser, 'wheel then F5, typed URL (no route state)', { routeState: null });
        await runWheelReloadScenario(browser, 'wheel then F5, no saved offset: page top of lastPageRead', {
            routeState: ROUTE_STATE_START,
            clearOffsetBeforeReload: true,
        });

        // Slow network, pages in order: everything around the target arrives after the first scroll.
        await runScenario(browser, 'slow images', {
            imageDelayMs: (index) => IMAGE_DELAY_MS * (index + 1),
            viewport: { width: 1280, height: 900 },
        });
        // The owner's server: images arrive at once (LAN / cache), the pages above the target stay unloaded
        // placeholders, so the layout settles before upstream's own scroll to the page top.
        await runScenario(browser, 'instant images, unloaded placeholders above', {
            imageDelayMs: () => 0,
            viewport: { width: 1280, height: 957 },
        });

        // Webtoon mode from the manga (auto webtoon for a manhwa), not from a global setting: the reading mode is only
        // known once the manga is loaded.
        await runScenario(browser, 'auto webtoon (manhwa), instant images', {
            imageDelayMs: () => 0,
            viewport: { width: 1280, height: 957 },
            serverOptions: { genre: ['Manhwa'], globalMeta: {} },
        });

        // The target image arrives after the pin's 10 s limit: the offset still has to apply once it has its height.
        await runScenario(browser, 'target image after the 10 s limit', {
            imageDelayMs: (index) => (index === LAST_PAGE_READ ? 11_000 : 0),
            viewport: { width: 1280, height: 957 },
        });
        // A click that doesn't scroll (focus, opening the reader menu) before the target image arrives.
        await runScenario(browser, 'click before the target image loads', {
            imageDelayMs: (index) => (index === LAST_PAGE_READ ? 3000 : 0),
            viewport: { width: 1280, height: 957 },
            onLoadStart: async (page) => {
                await page.waitForTimeout(1500);
                await page.mouse.click(640, 478);
            },
        });

        await browser.close();
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
