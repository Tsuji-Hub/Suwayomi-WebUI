/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of raws / MTL / Compare (brief #6 v2) on the production build: a mocked Suwayomi with an English
// series, its Korean raw and its MTL series (plus a Chinese pair and a series without links), and a fake relay
// serving /mtl/raws.json and the pre-signed translate pages. Checks the series page chips and the translate dialog
// (server confirm page, Yes inside the frame, Cancel, feed refetched), no library writes, Compare mapping by the raw
// names (KR first N화, CN last 第N话) and syncing by chapter fraction, and the end-of-release offers.
//
// Usage: pnpm build && node tools/scripts/tsuji/raws.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const RELAY = 'http://suwayomi.test:4568';
const VIEWPORT = { width: 1920, height: 1080 };
const CONTINUOUS_VERTICAL = '2';

const EN_ID = 12210;
const RAW_ID = 13858;
const MTL_ID = 14377;
const CN_EN_ID = 12897;
const CN_RAW_ID = 13148;
const PLAIN_ID = 500;

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
// English pages are long stitched strips, raw pages short: page counts differ, the chapter fraction must not.
const EN_PAGE = png(720, 1400, [60, 90, 160]);
const RAW_PAGE = png(600, 800, [160, 80, 60]);
const EN_PAGES = 4;
const RAW_PAGES = 12;

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

const mangaOf = (id, title, meta = []) => ({
    id,
    title,
    sourceId: '1',
    inLibrary: id === EN_ID || id === CN_EN_ID || id === PLAIN_ID,
    genre: [],
    source: { id: '1', name: 'Local source', displayName: 'Local source' },
    meta,
});

const chaptersOf = (mangaId, entries) =>
    entries.map(([name, chapterNumber], index) => ({
        id: mangaId * 100 + index + 1,
        mangaId,
        name,
        chapterNumber,
        sourceOrder: index + 1,
        scanlator: null,
        isRead: false,
        isBookmarked: false,
        isDownloaded: false,
        lastPageRead: 0,
        pageCount: 0,
        uploadDate: '0',
        fetchedAt: '0',
        lastReadAt: '0',
        url: '',
    }));

const rawLinksMeta = (mangaId, entries) => ({
    key: 'tsuji_raw_links',
    value: JSON.stringify(entries),
    mangaId,
    __typename: 'MangaMetaType',
});

const createWorld = () => {
    const enChapters = chaptersOf(EN_ID, [
        ['Chapter 136', 136],
        ['Chapter 137', 137],
        ['Chapter 138', 138],
    ]);
    // Raw chapterNumbers are deliberately wrong: the mapping must come from the names.
    const rawChapters = chaptersOf(RAW_ID, [
        ['귀환자의 마법은 특별해야 합니다 136화', 5],
        ['귀환자의 마법은 특별해야 합니다 137화', 6],
        ['귀환자의 마법은 특별해야 합니다 138화 (2부 12화)', 7],
        ['🔒 귀환자의 마법은 특별해야 합니다 139화', 139],
    ]);
    const mtlChapters = chaptersOf(MTL_ID, [
        ['Chapter 139', 139],
        ['Chapter 140', 140],
    ]);
    const cnEnChapters = chaptersOf(CN_EN_ID, [['Chapter 45', 45]]);
    const cnRawChapters = chaptersOf(CN_RAW_ID, [
        ['第2季 第44话 网约车', 1],
        ['第2季 第3话 网约车司机 第45话', 2],
    ]);
    const plainChapters = chaptersOf(PLAIN_ID, [['Chapter 1', 1]]);

    const server = createMockSuwayomi({
        manga: mangaOf(EN_ID, 'Return to Player'),
        chapters: [...enChapters].reverse(),
        pageCount: EN_PAGES,
        globalMeta: { webUI_readingMode: CONTINUOUS_VERTICAL },
        extraMangas: [
            {
                manga: mangaOf(RAW_ID, '귀환자의 마법은 특별해야 합니다'),
                chapters: [...rawChapters].reverse(),
                pageCount: RAW_PAGES,
            },
            {
                manga: mangaOf(MTL_ID, 'Return to Player [MTL]'),
                chapters: [...mtlChapters].reverse(),
                pageCount: EN_PAGES,
            },
            {
                manga: mangaOf(CN_EN_ID, 'Ride-hailing Driver', [
                    rawLinksMeta(CN_EN_ID, [
                        { kind: 'raw', mangaId: CN_RAW_ID, title: '网约车司机', source: 'Kuaikan' },
                    ]),
                ]),
                chapters: cnEnChapters,
                pageCount: EN_PAGES,
            },
            { manga: mangaOf(CN_RAW_ID, '网约车司机'), chapters: [...cnRawChapters].reverse(), pageCount: RAW_PAGES },
            { manga: mangaOf(PLAIN_ID, 'No Links Here'), chapters: plainChapters, pageCount: EN_PAGES },
        ],
    });
    server.mangaMeta.set(
        'tsuji_raw_links',
        JSON.stringify([
            {
                kind: 'raw',
                mangaId: RAW_ID,
                title: '귀환자의 마법은 특별해야 합니다',
                source: 'GoodToon',
                numbering: 'stale',
            },
            { kind: 'mtl', mangaId: MTL_ID },
        ]),
    );

    const signed = (raw, ch, n) => `${RELAY}/mtl/t?raw=${raw}&ch=${ch}&n=${n}&sig=s${raw}${n}`;
    const feed = {
        at: '2026-10-20T00:00:00Z',
        linked: 2,
        rows: [
            {
                title: 'Return to Player',
                en_id: EN_ID,
                en_max: '138',
                raw_id: RAW_ID,
                raw_max: '249',
                ahead: 110,
                source: 'GoodToon',
                origin: 'KR',
                uncensored: false,
                cover: `${ORIGIN}/api/v1/manga/${EN_ID}/thumbnail`,
                en_url: `${ORIGIN}/manga/${EN_ID}`,
                raw_url: `${ORIGIN}/manga/${RAW_ID}`,
                mtl_url: `${ORIGIN}/manga/${MTL_ID}`,
                done: 2,
                next: '141',
                queued: 1,
                t_next: signed(RAW_ID, 141, 1),
                t_10: signed(RAW_ID, 141, 10),
                t_all: signed(RAW_ID, 141, 108),
                n_all: 108,
                cancel: `${RELAY}/mtl/cancel?raw=${RAW_ID}&sig=c`,
            },
            {
                title: 'Ride-hailing Driver',
                en_id: CN_EN_ID,
                en_max: '45',
                raw_id: CN_RAW_ID,
                raw_max: '50',
                ahead: 5,
                source: 'Kuaikan',
                origin: 'CN',
                uncensored: true,
                mtl_url: '',
                done: 0,
                next: '46',
                queued: 0,
                t_next: signed(CN_RAW_ID, 46, 1),
                t_10: '',
                t_all: signed(CN_RAW_ID, 46, 5),
                n_all: 5,
                cancel: '',
            },
        ],
    };

    return { server, feed, rawChapters, cnRawChapters, mtlChapters };
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

const html = (body) => `<!doctype html><meta charset="utf-8"><body style="background:#111;color:#eee">${body}</body>`;

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;
    const { server, feed, rawChapters, cnRawChapters, mtlChapters } = createWorld();
    const relayRequests = [];

    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        if (url.origin === RELAY) {
            relayRequests.push(`${url.pathname}${url.search}`);
            if (url.pathname === '/mtl/raws.json') {
                return route.fulfill({
                    status: 200,
                    headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                    body: JSON.stringify(feed),
                });
            }
            if (url.pathname === '/mtl/t') {
                const isBatch = Number(url.searchParams.get('n')) > 10 && !url.searchParams.has('confirm');
                return route.fulfill({
                    status: 200,
                    contentType: 'text/html',
                    body: isBatch
                        ? html(`<p>Translate them all?</p><a href="t${url.search}&confirm=1">Yes</a>`)
                        : html(`<p>Queued chapter ${url.searchParams.get('ch')}</p>`),
                });
            }
            if (url.pathname === '/mtl/cancel') {
                feed.rows[0].queued = 0;
                return route.fulfill({ status: 200, contentType: 'text/html', body: html('<p>Cancelled</p>') });
            }
            return route.fulfill({ status: 404, body: '' });
        }
        if (url.origin !== ORIGIN) {
            return route.abort();
        }
        if (url.pathname.startsWith('/api/graphql')) {
            const result = await server.handle(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
        }
        const pageMatch = url.pathname.match(/\/manga\/(\d+)\/chapter\/\d+\/page\/\d+$/);
        if (pageMatch) {
            const isRaw = [RAW_ID, CN_RAW_ID].includes(Number(pageMatch[1]));
            return route.fulfill({ status: 200, contentType: 'image/png', body: isRaw ? RAW_PAGE : EN_PAGE });
        }
        if (url.pathname.startsWith('/api/')) {
            return route.fulfill({ status: 404, body: '' });
        }
        return route.fulfill(serveFile(url.pathname));
    });
    await context.routeWebSocket(/.*/, (ws) => ws.close());
    const page = await context.newPage();
    const pageErrors = [];
    const consoleErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => message.type() === 'error' && consoleErrors.push(message.text()));

    // Series page.
    await page.goto(`${ORIGIN}/manga/${EN_ID}`);
    const chips = page.getByRole('region', { name: 'Raws' }).or(page.locator('section[aria-label="Raws"]'));
    await chips
        .first()
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page
        .getByRole('button', { name: 'Translate 141' })
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const chipText = await chips
        .first()
        .innerText()
        .catch(() => '');
    check(
        label('series page: Raw · GoodToon, MTL · 2 translated, Translate 141 / Next 10 / All 108, Cancel'),
        ['Raw · GoodToon', 'MTL · 2 translated', 'TRANSLATE 141', 'NEXT 10', 'ALL 108', 'CANCEL'].every((text) =>
            chipText.toUpperCase().includes(text.toUpperCase()),
        ),
        { chipText },
    );
    check(
        label('raw and MTL chips link to their series in the app'),
        (await page.getByRole('link', { name: 'Raw · GoodToon' }).getAttribute('href')) === `/manga/${RAW_ID}` &&
            (await page.getByRole('link', { name: 'MTL · 2 translated' }).getAttribute('href')) === `/manga/${MTL_ID}`,
        {},
    );
    check(label('no 18+ badge for a series that is not uncensored'), !chipText.includes('18+'), {});

    const feedLoads = () => relayRequests.filter((request) => request.startsWith('/mtl/raws.json')).length;
    const loadsBefore = feedLoads();
    await page.getByRole('button', { name: 'All 108' }).click();
    const dialog = page.getByRole('dialog', { name: 'Translate all 108' });
    await dialog.waitFor({ timeout: 5000 }).catch(() => {});
    const frame = page.frameLocator('iframe[title="Translate all 108"]');
    await frame
        .getByText('Translate them all?')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    check(
        label('"All 108" shows the server confirm page in the dialog'),
        await frame
            .getByText('Translate them all?')
            .isVisible()
            .catch(() => false),
        {},
    );
    // Under load the first click can land while the frame is still settling: retry once if no confirm arrives.
    const isConfirmed = () =>
        relayRequests.some((request) => request.includes('n=108') && request.includes('confirm=1'));
    for (let attempt = 0; attempt < 2 && !isConfirmed(); attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await frame
            .getByRole('link', { name: 'Yes' })
            .click({ timeout: 5000 })
            .catch(() => {});
        // oxlint-disable-next-line no-await-in-loop
        await frame
            .getByText('Queued chapter 141')
            .waitFor({ timeout: 5000 })
            .catch(() => {});
    }
    check(
        label('Yes inside the frame confirms on the server (relative link)'),
        relayRequests.some((request) => request.includes('n=108') && request.includes('confirm=1')),
        relayRequests,
    );
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(800);
    check(label('closing the dialog re-fetches the feed'), feedLoads() > loadsBefore, {
        loadsBefore,
        after: feedLoads(),
    });

    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page
        .frameLocator('iframe[title="Cancel translation"]')
        .getByText('Cancelled')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();
    await page.waitForTimeout(1000);
    check(
        label('Cancel opens the cancel link; after the refetch the Cancel button is gone (nothing queued)'),
        relayRequests.some((request) => request.startsWith('/mtl/cancel')) &&
            (await page.getByRole('button', { name: 'Cancel', exact: true }).count()) === 0,
        {},
    );

    await page.getByRole('link', { name: 'Raw · GoodToon' }).click();
    await page.waitForURL(`**/manga/${RAW_ID}`, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const libraryWrites = server.mutationLog.filter(({ name, args }) => {
        const text = JSON.stringify(args);
        return /updateManga|updateMangas|Categor|Library/i.test(name) || text.includes('inLibrary');
    });
    check(label('opening the raw series writes nothing to the library'), libraryWrites.length === 0, libraryWrites);

    // A Korean / adult raw is badged.
    await page.goto(`${ORIGIN}/manga/${CN_EN_ID}`);
    await page
        .getByText('18+ raw')
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    check(
        label('"18+ raw" badge when the feed marks the raw uncensored'),
        await page
            .getByText('18+ raw')
            .isVisible()
            .catch(() => false),
        {},
    );

    // Series without links: no chips, no errors.
    await page.goto(`${ORIGIN}/manga/${PLAIN_ID}`);
    await page
        .getByRole('heading', { name: 'Similar' })
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1000);
    check(
        label('a series with no links shows no raw chips'),
        (await page.locator('section[aria-label="Raws"]').count()) === 0,
        {},
    );

    // Reader: Compare on EN ch 138.
    const openMenu = async (button) => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
            // oxlint-disable-next-line no-await-in-loop
            if (await button.isVisible().catch(() => false)) {
                return;
            }
            // oxlint-disable-next-line no-await-in-loop
            await page.waitForTimeout(1200);
            // oxlint-disable-next-line no-await-in-loop
            await page.mouse.click(VIEWPORT.width / 2, 300);
            // oxlint-disable-next-line no-await-in-loop
            await button.waitFor({ timeout: 1500 }).catch(() => {});
        }
    };
    await page.goto(`${ORIGIN}/manga/${EN_ID}/chapter/3`);
    const compare = page.getByRole('button', { name: 'Compare with raw' });
    await openMenu(compare);
    check(
        label('reader menu offers Compare for a series with a raw'),
        await compare.isVisible().catch(() => false),
        {},
    );
    await compare.click().catch(() => {});
    await page.keyboard.press('m');
    const pane = page.getByRole('region', { name: 'Raw chapter' });
    await pane.waitFor({ timeout: 10_000 }).catch(() => {});
    await page
        .waitForFunction((count) => document.querySelectorAll('img[alt^="Raw page"]').length === count, RAW_PAGES, {
            timeout: 15_000,
        })
        .catch(() => {});
    await page.waitForTimeout(1500);
    const expectedRaw = rawChapters.find(({ name }) => name.includes('138화'));
    check(
        label('Compare on EN 138 shows the raw chapter whose FIRST N화 is 138 (not its chapterNumber 7)'),
        (await pane.getAttribute('data-raw-chapter').catch(() => null)) === String(expectedRaw.id),
        { shown: await pane.getAttribute('data-raw-chapter').catch(() => null), expected: expectedRaw.id },
    );
    const englishBox = await page.locator('img[alt="Page #1"]').last().boundingBox();
    const paneBox = await pane.boundingBox();
    check(
        label('split view: English in the left half, raw pane in the right half'),
        !!englishBox &&
            !!paneBox &&
            englishBox.x === 0 &&
            englishBox.x + englishBox.width <= VIEWPORT.width / 2 &&
            Math.abs(paneBox.x - VIEWPORT.width / 2) <= 1,
        { englishBox, paneBox },
    );

    // Scroll the English chapter to 50 % (by the pane's own reading of the fraction) and compare positions.
    const readSync = () =>
        page.evaluate(() => {
            const paneElement = document.querySelector('[aria-label="Raw chapter"]');
            return {
                fraction: Number(paneElement?.dataset.fraction ?? -1),
                rawRatio: paneElement
                    ? paneElement.scrollTop / (paneElement.scrollHeight - paneElement.clientHeight)
                    : -1,
            };
        });
    const scrollEnglishBy = (delta) =>
        page.evaluate((amount) => {
            const image = document.querySelector('img[alt="Page #1"]');
            let scroller = image?.parentElement;
            while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
                scroller = scroller.parentElement;
            }
            scroller?.scrollBy({ top: amount });
        }, delta);
    let sync = await readSync();
    for (let step = 0; step < 60 && Math.abs(sync.fraction - 0.5) > 0.02; step += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await scrollEnglishBy(sync.fraction < 0.5 ? 120 : -60);
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(80);
        // oxlint-disable-next-line no-await-in-loop
        sync = await readSync();
    }
    check(
        label('English at 50 % of the chapter puts the raw at about 50 %'),
        Math.abs(sync.fraction - 0.5) <= 0.03 && Math.abs(sync.rawRatio - 0.5) <= 0.05,
        sync,
    );

    // End of the newest English chapter: the MTL series has 139.
    await scrollEnglishBy(100_000);
    const readMtl = page.getByRole('button', { name: 'Read MTL ch 139' });
    await readMtl.waitFor({ timeout: 10_000 }).catch(() => {});
    check(label('end of EN 138: "Read MTL ch 139"'), await readMtl.isVisible().catch(() => false), {});
    await readMtl.click().catch(() => {});
    await page.waitForURL(`**/manga/${MTL_ID}/chapter/**`, { timeout: 10_000 }).catch(() => {});
    const mtl139 = mtlChapters.find(({ chapterNumber }) => chapterNumber === 139);
    check(
        label('"Read MTL ch 139" opens that MTL chapter'),
        page.url().endsWith(`/manga/${MTL_ID}/chapter/${mtl139.sourceOrder}`),
        { url: page.url() },
    );
    const compareAfterLeaving = await page.getByRole('region', { name: 'Raw chapter' }).count();
    check(label('Compare does not follow into another series'), compareAfterLeaving === 0, {});

    // CN: last 第N话; no MTL series, raw ahead: the end offers Translate.
    await page.goto(`${ORIGIN}/manga/${CN_EN_ID}/chapter/1`);
    const cnCompare = page.getByRole('button', { name: 'Compare with raw' });
    await openMenu(cnCompare);
    await cnCompare.click().catch(() => {});
    await page.keyboard.press('m');
    const cnPane = page.getByRole('region', { name: 'Raw chapter' });
    await cnPane.waitFor({ timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(1500);
    const expectedCn = cnRawChapters.find(({ name }) => name.endsWith('第45话'));
    check(
        label('CN: Compare maps by the LAST 第N话 (EN 45 -> "第2季 第3话 ... 第45话")'),
        (await cnPane.getAttribute('data-raw-chapter').catch(() => null)) === String(expectedCn.id),
        { shown: await cnPane.getAttribute('data-raw-chapter').catch(() => null), expected: expectedCn.id },
    );
    await scrollEnglishBy(100_000);
    const translate = page.getByRole('button', { name: 'Translate ch 46' });
    await translate.waitFor({ timeout: 10_000 }).catch(() => {});
    await translate.click().catch(() => {});
    await page
        .frameLocator('iframe')
        .getByText('Queued chapter 46')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    check(
        label('end of the CN release without MTL: "Translate ch 46" opens t_next in the dialog'),
        relayRequests.some((request) => request.includes(`raw=${CN_RAW_ID}&ch=46&n=1`)),
        relayRequests.filter((request) => request.includes(String(CN_RAW_ID))),
    );

    check(label('no page errors'), pageErrors.length === 0, pageErrors);
    // The browser's own network log for requests the test blocks (AniList) is not the app's.
    const appErrors = consoleErrors.filter(
        (text) => !/Failed to load resource|net::ERR_|Cross-Origin Request Blocked/.test(text),
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
