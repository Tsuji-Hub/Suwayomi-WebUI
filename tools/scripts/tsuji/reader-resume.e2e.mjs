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

const createServer = () => {
    const manga = {
        id: MANGA_ID,
        title: 'Resume Test',
        sourceId: '1',
        inLibrary: true,
        genre: [],
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
        globalMeta: { webUI_readingMode: WEBTOON },
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

const run = async () => {
    const server = createServer();
    const browser = await launch();
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });

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
            // Slow, in page order: pages above the target have no height while the reader first scrolls.
            await new Promise((done) => {
                setTimeout(done, IMAGE_DELAY_MS * (index + 1));
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
    page.on('pageerror', (error) => console.log('pageerror:', error.message));

    const checkPosition = async (label) => {
        const m = await measure(page);
        const expected = m ? Math.round(m.pageTop + m.pageHeight * OFFSET) : null;
        check(
            `${label}: scrollTop is page ${LAST_PAGE_READ} + ${OFFSET}`,
            !!m && Math.abs(m.scrollTop - expected) <= 2,
            {
                ...m,
                expected,
            },
        );
    };

    const verifyResume = async (label) => {
        // All page images are in by then; the second look is after the pin's 8 s limit.
        await page.waitForTimeout(Math.max(2000, IMAGE_DELAY_MS * (PAGE_COUNT + 2)));
        await checkPosition(`${label} at ~3s`);
        await page.waitForTimeout(7000);
        await checkPosition(`${label} at ~10s`);
        const lowest = Math.min(
            ...server.chapterWrites
                .filter((write) => write.lastPageRead !== undefined)
                .map((write) => write.lastPageRead),
        );
        check(`${label}: no lastPageRead below ${LAST_PAGE_READ} written`, !(lowest < LAST_PAGE_READ), {
            writes: server.chapterWrites,
        });
    };

    // Direct URL load: no navigation state, like a bookmark or typing the address.
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/1`);
    await verifyResume('direct load');

    // Hard reload of that tab (F5).
    await page.reload();
    await verifyResume('reload');

    // The user takes over: a wheel scroll up must not be pulled back.
    const before = await measure(page);
    await page.mouse.move(640, 450);
    await page.mouse.wheel(0, -600);
    await page.waitForTimeout(800);
    const after = await measure(page);
    check('wheel releases the pin', !!after && after.scrollTop < before.scrollTop - 300, {
        before: before?.scrollTop,
        after: after?.scrollTop,
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
