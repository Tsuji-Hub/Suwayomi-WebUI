/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of the reader page position (brief #7) on the production build with a mocked Suwayomi, at 1920x1080:
// in continuous vertical, LEFT with offset 0 puts the page image at left = 0 with the same width as CENTER; RIGHT
// puts it against the scroll area's right edge; the offset moves it off the edge; the choice is per device preset
// (raw tsuji_ keys), survives F5, can be switched from the reader menu and cycled with Shift+L; single page and
// webtoon with a reader width follow it too; the center tap zone still opens the menu, the right one still turns
// the page, and the reader still resumes on lastPageRead.
//
// Usage: pnpm build && node tools/scripts/tsuji/reader-position.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const MANGA_ID = 77;
const PAGE_COUNT = 6;
const VIEWPORT = { width: 1920, height: 1080 };
const READING_MODE = { SINGLE_PAGE: '0', DOUBLE_PAGE: '1', CONTINUOUS_VERTICAL: '2', WEBTOON: '4' };

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
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        chunk('IHDR', header),
        chunk('IDAT', deflateSync(Buffer.concat(Array.from({ length: height }, () => row)))),
        chunk('IEND', Buffer.alloc(0)),
    ]);
};
const pageImages = Array.from({ length: PAGE_COUNT }, (_, index) => png(720, 1400, [40 + index * 30, 90, 160]));

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

const chapter = (sourceOrder, lastPageRead = 0) => ({
    id: 7700 + sourceOrder,
    mangaId: MANGA_ID,
    name: `Chapter ${sourceOrder}`,
    chapterNumber: sourceOrder,
    sourceOrder,
    scanlator: null,
    isRead: false,
    isBookmarked: false,
    isDownloaded: false,
    lastPageRead,
    pageCount: PAGE_COUNT,
    uploadDate: '0',
    fetchedAt: '0',
    lastReadAt: '0',
    url: '',
});

const createServer = (globalMeta, { lastPageRead = 0, chapterCount = 1 } = {}) =>
    createMockSuwayomi({
        manga: {
            id: MANGA_ID,
            title: 'Position Test',
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local source', displayName: 'Local source' },
            chapters: { totalCount: chapterCount },
        },
        // Newest first, like the server's chapter list.
        chapters: Array.from({ length: chapterCount }, (_, index) => chapter(chapterCount - index, lastPageRead)),
        pageCount: PAGE_COUNT,
        globalMeta,
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
    firefox: () => firefox.launch(),
};

const failures = [];
const check = (label, ok, detail) => {
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label}: ${JSON.stringify(detail)}`);
    if (!ok) {
        failures.push(label);
    }
};

/** Page image rect plus the scroll area's visible width (the window minus a vertical scrollbar). */
const measure = (page, pageNumber = 1) =>
    page.evaluate((number) => {
        const image = document.querySelector(`img[alt="Page #${number}"]`);
        if (!image) {
            return null;
        }
        let scroller = image.parentElement;
        while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
            scroller = scroller.parentElement;
        }
        const rect = image.getBoundingClientRect();
        const scrollerRect = scroller?.getBoundingClientRect();
        return {
            left: Math.round(rect.left),
            right: Math.round(rect.right),
            top: Math.round(rect.top - (scrollerRect?.top ?? 0)),
            width: Math.round(rect.width),
            areaLeft: Math.round(scrollerRect?.left ?? 0),
            areaRight: Math.round((scrollerRect?.left ?? 0) + (scroller?.clientWidth ?? 0)),
        };
    }, pageNumber);

const waitForPage = async (page, pageNumber = 1) => {
    await page
        .waitForFunction(
            (number) => {
                const image = document.querySelector(`img[alt="Page #${number}"]`);
                return !!image && image.complete && image.naturalHeight > 0 && image.getBoundingClientRect().width > 0;
            },
            pageNumber,
            { timeout: 20_000 },
        )
        .catch(() => {});
    await page.waitForTimeout(400);
};

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;

    const open = async (server, { device } = {}) => {
        const context = await browser.newContext({ viewport: VIEWPORT });
        if (device) {
            await context.addInitScript((name) => localStorage.setItem('activeDevice', JSON.stringify(name)), device);
        }
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
                return route.fulfill({ status: 200, contentType: 'image/png', body: pageImages[Number(pageMatch[1])] });
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
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/1`);
        await waitForPage(page);
        return { context, page, pageErrors };
    };

    // Continuous vertical: CENTER, then LEFT / offset / RIGHT from the stored setting.
    const server = createServer({ webUI_readingMode: READING_MODE.CONTINUOUS_VERTICAL });
    const { context, page, pageErrors } = await open(server);
    const center = await measure(page);
    check(
        label('continuous vertical, CENTER (default): page in the middle'),
        !!center && Math.abs(center.left - center.areaLeft - (center.areaRight - center.right)) <= 2,
        center,
    );

    server.meta.set('tsuji_pagePosition', 'LEFT');
    await page.reload();
    await waitForPage(page);
    const left = await measure(page);
    check(
        label('LEFT, offset 0: image at left = 0, same width as CENTER'),
        !!left && !!center && left.left === 0 && left.width === center.width,
        { left, centerWidth: center?.width },
    );
    check(label('LEFT survives F5 (it was set before the reload)'), left?.left === 0, {});

    server.meta.set('tsuji_pageEdgeOffset', '120');
    await page.reload();
    await waitForPage(page);
    const offset = await measure(page);
    check(
        label('LEFT, offset 120: image at left = 120, same width'),
        offset?.left === 120 && offset?.width === center?.width,
        offset,
    );

    // The reader menu: the center tap zone still opens it, and its quick setting switches to RIGHT.
    // The toggle by its value (role names are computed slightly differently across browsers).
    const rightButton = page.locator('[aria-label="Page position"] button[value="RIGHT"]');
    for (let attempt = 0; attempt < 6; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop
        if (await rightButton.isVisible().catch(() => false)) {
            break;
        }
        // Wait out the tap-zone preview first; every other try uses the menu hotkey (m) instead of a tap.
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(1500);
        // oxlint-disable-next-line no-await-in-loop
        await (attempt % 2 === 0 ? page.mouse.click(VIEWPORT.width / 2, 300) : page.keyboard.press('m'));
        // oxlint-disable-next-line no-await-in-loop
        await rightButton.waitFor({ timeout: 1500 }).catch(() => {});
    }
    check(
        label('reader menu (center tap, else m) has Left / Center / Right'),
        await rightButton.isVisible().catch(() => false),
        await page.evaluate(() => ({
            group: document.querySelector('[aria-label="Page position"]')?.outerHTML.slice(0, 300) ?? null,
            settingsButton: !!document.querySelector(
                'button[aria-label="Settings"], button svg[data-testid="SettingsIcon"]',
            ),
            buttons: [...document.querySelectorAll('button')]
                .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim())
                .filter(Boolean)
                .slice(0, 25),
        })),
    );
    await rightButton.click().catch(() => {});
    await page.waitForTimeout(800);
    check(
        label('quick setting writes tsuji_pagePosition (default device)'),
        server.meta.get('tsuji_pagePosition') === 'RIGHT',
        {
            stored: server.meta.get('tsuji_pagePosition'),
        },
    );
    await page.keyboard.press('m');
    await page.waitForTimeout(600);
    const right = await measure(page);
    check(
        label('RIGHT, offset 120: image ends 120 px before the scroll area edge, same width'),
        !!right && right.areaRight - right.right === 120 && right.width === center?.width,
        right,
    );

    // Shift+L cycles to the next position.
    const beforeCycle = server.meta.get('tsuji_pagePosition') ?? 'CENTER';
    const expectedAfterCycle = { LEFT: 'CENTER', CENTER: 'RIGHT', RIGHT: 'LEFT' }[beforeCycle];
    await page.mouse.move(VIEWPORT.width - 50, 600);
    await page.keyboard.press('Shift+L');
    await page.waitForTimeout(800);
    check(
        label(`Shift+L cycles ${beforeCycle} -> ${expectedAfterCycle}`),
        server.meta.get('tsuji_pagePosition') === expectedAfterCycle,
        { stored: server.meta.get('tsuji_pagePosition') },
    );
    check(label('no page errors'), pageErrors.length === 0, pageErrors);
    await context.close();

    // Device preset: another device reads its own key.
    {
        const presetServer = createServer({
            webUI_readingMode: READING_MODE.CONTINUOUS_VERTICAL,
            tsuji_pagePosition: 'LEFT',
            tsuji_GamingPC_pagePosition: 'RIGHT',
        });
        const preset = await open(presetServer, { device: 'GamingPC' });
        const box = await measure(preset.page);
        check(
            label('device preset GamingPC uses tsuji_GamingPC_pagePosition (RIGHT), not the default LEFT'),
            !!box && box.right === box.areaRight,
            box,
        );
        await preset.context.close();
    }

    // Single page: LEFT, and the right tap zone still turns the page.
    {
        const singleServer = createServer({ webUI_readingMode: READING_MODE.SINGLE_PAGE, tsuji_pagePosition: 'LEFT' });
        const single = await open(singleServer);
        const box = await measure(single.page);
        check(label('single page, LEFT: image at left = 0'), box?.left === 0, box);
        await single.page.mouse.click(VIEWPORT.width - 100, VIEWPORT.height / 2);
        await waitForPage(single.page, 2);
        const second = await measure(single.page, 2);
        check(label('single page: the right tap zone (empty area) still turns the page'), second?.left === 0, second);
        await single.context.close();
    }

    // Webtoon with the owner's reader width (43 %, stretched): LEFT keeps the page size.
    {
        const webtoonMeta = {
            webUI_readingMode: READING_MODE.WEBTOON,
            webUI_4_pageScaleMode: '0',
            webUI_4_readerWidth: JSON.stringify({ value: 43, enabled: true }),
            webUI_4_shouldStretchPage: 'true',
        };
        const centered = await open(createServer(webtoonMeta));
        const centerBox = await measure(centered.page);
        await centered.context.close();
        const leftAligned = await open(createServer({ ...webtoonMeta, tsuji_pagePosition: 'LEFT' }));
        const leftBox = await measure(leftAligned.page);
        check(
            label('webtoon + reader width 43 %: LEFT at left = 0, same width as CENTER'),
            leftBox?.left === 0 && leftBox?.width === centerBox?.width,
            { centerBox, leftBox },
        );
        await leftAligned.context.close();
    }

    // Double page: the spread moves as a whole and stays joined.
    {
        const doubleServer = createServer({ webUI_readingMode: READING_MODE.DOUBLE_PAGE, tsuji_pagePosition: 'LEFT' });
        const double = await open(doubleServer);
        await waitForPage(double.page, 2);
        const first = await measure(double.page, 1);
        const second = await measure(double.page, 2);
        const [leftImage, rightImage] = [first, second].sort((a, b) => (a?.left ?? 0) - (b?.left ?? 0));
        check(
            label('double page, LEFT: spread at left = 0, both pages still joined'),
            leftImage?.left === 0 && Math.abs((leftImage?.right ?? 0) - (rightImage?.left ?? -9)) <= 1,
            { first, second },
        );
        await double.context.close();
    }

    // Infinite scroll: the next chapter, appended below, follows the position too.
    {
        const chaptersServer = createServer(
            { webUI_readingMode: READING_MODE.CONTINUOUS_VERTICAL, tsuji_pagePosition: 'RIGHT' },
            { chapterCount: 2 },
        );
        const both = await open(chaptersServer);
        await both.page.evaluate(() => {
            const image = document.querySelector('img[alt="Page #1"]');
            let scroller = image?.parentElement;
            while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
                scroller = scroller.parentElement;
            }
            scroller?.scrollTo({ top: scroller.scrollHeight });
        });
        await both.page.waitForTimeout(2500);
        const rights = await both.page.evaluate(() =>
            [...document.querySelectorAll('img[alt^="Page #"]')]
                .filter((image) => image.complete && image.naturalHeight > 0 && image.getBoundingClientRect().width > 0)
                .map((image) => Math.round(image.getBoundingClientRect().right)),
        );
        const areaRight = (await measure(both.page, 1))?.areaRight;
        check(
            label('infinite scroll: every loaded page of both chapters at the right edge'),
            rights.length > PAGE_COUNT && rights.every((pageRight) => pageRight === areaRight),
            { count: rights.length, areaRight, rights: [...new Set(rights)] },
        );
        await both.context.close();
    }

    // Resume: with LEFT the reader still opens on lastPageRead (page 4 at the top).
    {
        const resumeServer = createServer(
            { webUI_readingMode: READING_MODE.CONTINUOUS_VERTICAL, tsuji_pagePosition: 'LEFT' },
            { lastPageRead: 3 },
        );
        const resumed = await open(resumeServer);
        await waitForPage(resumed.page, 4);
        await resumed.page.waitForTimeout(1500);
        const box = await measure(resumed.page, 4);
        check(
            label('LEFT: resume still lands on lastPageRead (page 4 at the top)'),
            !!box && Math.abs(box.top) <= 50 && box.left === 0,
            box,
        );
        await resumed.page.reload();
        await waitForPage(resumed.page, 4);
        await resumed.page.waitForTimeout(1500);
        const afterReload = await measure(resumed.page, 4);
        check(
            label('LEFT: F5 resumes on the same page'),
            !!afterReload && Math.abs(afterReload.top) <= 50,
            afterReload,
        );
        await resumed.context.close();
    }

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
