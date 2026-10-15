/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of duplicate chapters (one entry per scanlator) on the production build (build/, or BUILD_DIR),
// against an in-memory Suwayomi (mockSuwayomi.mjs): read chapter 1 on scanlator A to the end in webtoon mode, the
// reader moves on to 2 on A (not 1 on B, not 2 on B), 1 on B is marked read on the server, and the manga page's
// Resume button then points at 2 on A.
//
// Usage: pnpm build && node tools/scripts/tsuji/duplicates.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const MANGA_ID = 7;
const PAGE_COUNT = 3;
const WEBTOON = '4';
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
const png = (width, height) => {
    const header = Buffer.alloc(13);
    header.writeUInt32BE(width, 0);
    header.writeUInt32BE(height, 4);
    header.set([8, 2, 0, 0, 0], 8);
    const row = Buffer.alloc(1 + width * 3, 120);
    row[0] = 0;
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};
const PAGE_IMAGE = png(600, 900);

/** Scanlators A and B both have 1-3, interleaved by source order like a real source. */
const CHAPTERS = [
    [101, 1, 1, 'A'],
    [201, 2, 1, 'B'],
    [102, 3, 2, 'A'],
    [202, 4, 2, 'B'],
    [103, 5, 3, 'A'],
    [203, 6, 3, 'B'],
    // Chapters the source couldn't number: different chapters, never copies of each other.
    [104, 7, -1, 'A'],
    [204, 8, -1, 'B'],
];
const idBySourceOrder = Object.fromEntries(CHAPTERS.map(([id, sourceOrder]) => [sourceOrder, id]));

const createServer = () =>
    createMockSuwayomi({
        manga: {
            id: MANGA_ID,
            title: 'Duplicates Test',
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local source', displayName: 'Local source' },
        },
        // Latest first, like the server's default order.
        chapters: [...CHAPTERS].reverse().map(([id, sourceOrder, chapterNumber, scanlator]) => ({
            id,
            mangaId: MANGA_ID,
            name: chapterNumber < 0 ? `Extra ${id}` : `Chapter ${chapterNumber}`,
            chapterNumber,
            sourceOrder,
            scanlator,
            isRead: false,
            isBookmarked: false,
            isDownloaded: false,
            lastPageRead: 0,
            pageCount: PAGE_COUNT,
            uploadDate: '0',
            fetchedAt: '0',
            lastReadAt: '0',
            url: '',
        })),
        pageCount: PAGE_COUNT,
        globalMeta: { webUI_readingMode: WEBTOON },
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
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const server = createServer();
    const pageErrors = [];

    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin !== ORIGIN) {
            return route.abort();
        }
        if (url.pathname.startsWith('/api/graphql')) {
            const result = await server.handle(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
        }
        if (/\/chapter\/\d+\/page\/\d+$/.test(url.pathname)) {
            return route.fulfill({ status: 200, contentType: 'image/png', body: PAGE_IMAGE });
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
    const currentSourceOrder = () => Number(new URL(page.url()).pathname.match(/chapter\/(\d+)/)?.[1]);

    /** Opens the chapter at `sourceOrder` and wheels down until the reader moves on (or the end). */
    const readToEnd = async (sourceOrder) => {
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/${sourceOrder}`);
        await page.waitForSelector('img[alt="Page #1"]', { timeout: 20_000 });
        await page.mouse.move(640, 450);
        for (let step = 0; step < 60 && currentSourceOrder() === sourceOrder; step += 1) {
            // oxlint-disable-next-line no-await-in-loop
            await page.mouse.wheel(0, 600);
            // oxlint-disable-next-line no-await-in-loop
            await page.waitForTimeout(150);
        }
        await page.waitForTimeout(2000);
    };
    const isChapterRead = (id) => server.chapters.get(id).isRead;

    // Chapter 1 on A (source order 1), read to the end.
    await readToEnd(1);

    const next = currentSourceOrder();
    check(label('next chapter after 1 on A is 2 on A'), next === 3, {
        sourceOrder: next,
        chapterId: idBySourceOrder[next],
    });

    const readIds = [...server.chapters.values()]
        .filter(({ isRead }) => isRead)
        .map(({ id }) => id)
        .sort();
    check(label('1 on A read, and its copy 1 on B marked read too'), readIds.includes(101) && readIds.includes(201), {
        readIds,
    });
    check(
        label('no other number marked read'),
        readIds.every((id) => id === 101 || id === 201),
        { readIds },
    );

    // Manga page: Resume points at 2 on A (the first number with no read copy, on the last read scanlator).
    await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
    // The link's accessible name is its tooltip ("Continue reading ..."), so find it by its text.
    const resume = page.locator('a', { hasText: 'Resume' });
    await resume.waitFor({ timeout: 20_000 }).catch(() => {});
    const href = await resume.getAttribute('href').catch(() => null);
    check(label('Resume goes to 2 on A'), !!href && href.endsWith(`/manga/${MANGA_ID}/chapter/3`), { href });
    check(
        label('the scanlator read in the reader is remembered in manga meta'),
        server.mangaMeta?.get('tsuji_readScanlator') === '"A"',
        {
            tsuji_readScanlator: server.mangaMeta?.get('tsuji_readScanlator'),
        },
    );

    // Manual mark from the chapter list: 3 on A -> 3 on B read too, nothing else.
    await page.locator(`a[href$="/manga/${MANGA_ID}/chapter/5"] [aria-label="more"]`).click();
    await page.getByRole('menuitem', { name: 'Mark as read' }).click();
    await page.waitForTimeout(1500);
    check(label('manual mark: 3 on A read, and its copy 3 on B'), isChapterRead(103) && isChapterRead(203), {
        '3A': isChapterRead(103),
        '3B': isChapterRead(203),
    });
    check(
        label('manual mark: no other number, no -1 chapter'),
        !isChapterRead(102) && !isChapterRead(202) && !isChapterRead(104) && !isChapterRead(204),
        {},
    );

    // Reading a -1 chapter to the end marks only that chapter (upstream grouped every -1 chapter as one).
    await readToEnd(7);
    check(label('-1 chapter read, the other -1 chapter untouched'), isChapterRead(104) && !isChapterRead(204), {
        '-1A': isChapterRead(104),
        '-1B': isChapterRead(204),
    });

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
