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

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium } from 'playwright-core';
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

const measure = (page) =>
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
    }, LAST_PAGE_READ);

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
    const server = createServer(serverOptions);
    const context = await browser.newContext({ viewport });
    const requestedPages = new Set();

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
            return route.fulfill({ status: 200, contentType: 'image/png', body: pageImages[index] });
        }
        if (url.pathname.startsWith('/api/')) {
            return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill(serveFile(url.pathname));
    });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
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

const run = async () => {
    const browser = await launch();

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

    // The target image arrives after the pin's 8 s limit: the offset still has to apply once it has its height.
    await runScenario(browser, 'target image after the 8 s limit', {
        imageDelayMs: (index) => (index === LAST_PAGE_READ ? 9500 : 0),
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
