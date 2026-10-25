/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of "English ran out" (brief #19) on the production build, modelled on The Game That I Came From
// (MangaFire 3526, filter on the unofficial scanlator: 223, 224, 226, 229; the official copy has 224 and 225), its raw
// (如漫画, 223-229) and its MTL series (225 done), with a fake MTL engine behind the relay (/mtl/s, /mtl/req,
// /mtl/align). Checks the series page's art-match line and report, the inline MTL row and its filter, the Missing row
// and the chapter menu, the reader's end card ("Read MTL 225" without a request), Next across the series
// (224 -> MTL 225 -> 226), Translate & read (queued, page counter, opens by itself, the partial chapter's note, the
// full page list without a reload), a bad signature (no retry loop), and that only the relay is contacted and no
// meta is written.
//
// Usage: pnpm build && node tools/scripts/tsuji/english-ran-out.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { deflateSync } from 'node:zlib';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
const ORIGIN = 'http://suwayomi.test';
const RELAY = 'http://suwayomi.test:4568';
const API = `${RELAY}/mtl`;
const VIEWPORT = { width: 1600, height: 1000 };
const CONTINUOUS_VERTICAL = '2';

const EN_ID = 3526;
const RAW_ID = 14662;
const MTL_ID = 16353;
const BAD_EN_ID = 4000;
const BAD_RAW_ID = 4001;
const GOOD_SIG = '45a2bd8d6431cb55427d0724';
const VERDICT = '= raw 224, both end at the same panel; next raw = 225';

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
const PAGE = png(720, 1200, [60, 90, 160]);
const EN_PAGES = 3;
/** The partial MTL chapter, then the full one. */
const PARTIAL_PAGES = 3;
const FULL_PAGES = 9;

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
    inLibrary: id === EN_ID || id === BAD_EN_ID,
    genre: [],
    source: { id: '1', name: 'Local source', displayName: 'Local source' },
    meta,
});

const chaptersOf = (mangaId, entries) =>
    entries.map(([name, chapterNumber, scanlator = null], index) => ({
        id: mangaId * 100 + index + 1,
        mangaId,
        name,
        chapterNumber,
        sourceOrder: index + 1,
        scanlator,
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

const rawEntry = (rawId, req) => ({
    kind: 'raw',
    mangaId: rawId,
    title: '我来自游戏',
    source: '如漫画',
    numbering: 'cn-last',
    req,
    api: API,
});

const createWorld = () => {
    const enChapters = chaptersOf(EN_ID, [
        ['Chapter 223', 223, 'Unofficial'],
        ['Chapter 224', 224, 'Unofficial'],
        ['Chapter 224', 224, 'Official'],
        ['Chapter 225', 225, 'Official'],
        ['Chapter 226', 226, 'Unofficial'],
        ['Chapter 229', 229, 'Unofficial'],
    ]);
    // Raw chapterNumbers are wrong on purpose: numbers come from the names.
    const rawChapters = chaptersOf(
        RAW_ID,
        [223, 224, 225, 226, 227, 228, 229].map((number, index) => [`我来自游戏 第${number}话`, index]),
    );
    const mtlChapters = chaptersOf(MTL_ID, [['Chapter 225', 225, 'MTL']]);
    const badEnChapters = chaptersOf(BAD_EN_ID, [['Chapter 1', 1]]);
    const badRawChapters = chaptersOf(BAD_RAW_ID, [
        ['第1话', 0],
        ['第2话', 1],
    ]);
    const mtlEntry = {
        manga: mangaOf(MTL_ID, 'The Game That I Came From [MTL]'),
        chapters: [...mtlChapters].reverse(),
        pageCount: EN_PAGES,
    };

    const server = createMockSuwayomi({
        manga: mangaOf(EN_ID, 'The Game That I Came From'),
        chapters: [...enChapters].reverse(),
        pageCount: EN_PAGES,
        globalMeta: { webUI_readingMode: CONTINUOUS_VERTICAL },
        extraMangas: [
            { manga: mangaOf(RAW_ID, '我来自游戏'), chapters: [...rawChapters].reverse(), pageCount: EN_PAGES },
            mtlEntry,
            {
                manga: mangaOf(BAD_EN_ID, 'Bad Signature Series', [
                    {
                        key: 'tsuji_raw_links',
                        value: JSON.stringify([rawEntry(BAD_RAW_ID, 'wrong')]),
                        mangaId: BAD_EN_ID,
                        __typename: 'MangaMetaType',
                    },
                ]),
                chapters: badEnChapters,
                pageCount: EN_PAGES,
            },
            { manga: mangaOf(BAD_RAW_ID, '坏签名'), chapters: [...badRawChapters].reverse(), pageCount: EN_PAGES },
        ],
    });
    server.mangaMeta.set(
        'tsuji_raw_links',
        JSON.stringify([
            rawEntry(RAW_ID, GOOD_SIG),
            { kind: 'mtl', mangaId: MTL_ID },
            {
                kind: 'align',
                en: 224.0,
                en_source: 'Asura Scans (EN)',
                raw: 224.0,
                score: 0.889,
                last_raw: 0.95,
                verdict: VERDICT,
                ok: true,
                next_raw: 225.0,
                at: 1792896300,
                boiler_skipped: 4,
            },
        ]),
    );
    server.mangaMeta.set('webUI_excludedScanlators', JSON.stringify(['Official']));

    /** The fake engine: 225 done; 227 moves on with each poll once requested. */
    const engine = {
        requests: [],
        polls: {},
        stage: { 225: 'ready' },
        steps227: 0,
    };
    const addMtl227 = () => {
        if (mtlEntry.chapters.some(({ chapterNumber }) => chapterNumber === 227)) {
            return;
        }
        const [chapter] = chaptersOf(MTL_ID, [
            ['Chapter 225', 225, 'MTL'],
            ['Chapter 227', 227, 'MTL'],
        ]).slice(1);
        mtlEntry.chapters.unshift(chapter);
        server.chapters.set(chapter.id, chapter);
        mtlEntry.pageCount = PARTIAL_PAGES;
    };
    const path = (sourceOrder) => `http://192.168.5.85:4567/manga/${MTL_ID}/chapter/${sourceOrder}`;
    const status = (raw, ch) => {
        if (raw !== RAW_ID) {
            return { state: 'none' };
        }
        if (ch === 225) {
            return { state: 'ready', url: path(1) };
        }
        if (ch !== 227 || !engine.stage[227]) {
            return { state: 'none' };
        }
        engine.steps227 += 1;
        const step = engine.steps227;
        if (step <= 1) {
            return { state: 'queued', position: 1 };
        }
        if (step === 2) {
            return { state: 'running', stage: 'fetch', elapsed: 4 };
        }
        if (step === 3) {
            return {
                state: 'running',
                stage: 'translate 1/2',
                pages_ready: 2,
                pages_total: FULL_PAGES,
                elapsed: 95,
            };
        }
        addMtl227();
        if (step === 4) {
            return {
                state: 'running',
                stage: 'translate 1/2',
                pages_ready: PARTIAL_PAGES,
                pages_total: FULL_PAGES,
                elapsed: 98,
                url: path(2),
            };
        }
        if (step <= 7) {
            return { state: 'partial', pages_ready: PARTIAL_PAGES, pages_total: FULL_PAGES, url: path(2) };
        }
        mtlEntry.pageCount = FULL_PAGES;
        return { state: 'ready', url: path(2) };
    };
    const answer = (url) => {
        const raw = Number(url.searchParams.get('raw'));
        const ch = Number(url.searchParams.get('ch'));
        if (url.pathname === '/mtl/s') {
            engine.polls[`${raw}:${ch}`] = (engine.polls[`${raw}:${ch}`] ?? 0) + 1;
            return { status: 200, body: status(raw, ch) };
        }
        if (url.pathname === '/mtl/req') {
            engine.requests.push(`${raw}:${ch}:${url.searchParams.get('sig')}`);
            if (url.searchParams.get('sig') !== GOOD_SIG) {
                return { status: 403, body: { ok: false } };
            }
            engine.stage[ch] = 'queued';
            return { status: 200, body: { ok: true, state: 'queued', position: 1 } };
        }
        if (url.pathname === '/mtl/align') {
            return {
                status: 200,
                body: {
                    raw: raw,
                    en_source: 'Asura Scans (EN)',
                    boiler_skipped: 4,
                    candidates: [
                        { raw: 224, score: 0.889, overlap: 0.91 },
                        { raw: 225, score: 0.12, overlap: 0.1 },
                    ],
                },
            };
        }
        if (url.pathname === '/mtl/raws.json') {
            return { status: 200, body: { at: '', linked: 0, rows: [] } };
        }
        return { status: 404, body: {} };
    };

    return { server, engine, answer, enChapters, mtlEntry };
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

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;
    const { server, engine, answer, enChapters, mtlEntry } = createWorld();
    const hosts = new Set();
    const relayPaths = [];

    const context = await browser.newContext({ viewport: VIEWPORT });
    await context.route('**/*', async (route) => {
        const url = new URL(route.request().url());
        hosts.add(url.origin);
        if (url.origin === RELAY) {
            relayPaths.push(url.pathname);
            const { status, body } = answer(url);
            return route.fulfill({
                status,
                headers: { 'access-control-allow-origin': '*', 'content-type': 'application/json' },
                body: JSON.stringify(body),
            });
        }
        if (url.origin !== ORIGIN) {
            return route.abort();
        }
        if (url.pathname.startsWith('/api/graphql')) {
            const result = await server.handle(route.request().postDataJSON());
            return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
        }
        if (/\/manga\/\d+\/chapter\/\d+\/page\/\d+$/.test(url.pathname)) {
            return route.fulfill({ status: 200, contentType: 'image/png', body: PAGE });
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
    if (process.env.E2E_SHOTS) {
        page.on(
            'console',
            (message) => message.type() === 'error' && console.log('CONSOLE', page.url(), message.text().slice(0, 300)),
        );
    }
    page.on('pageerror', (error) =>
        pageErrors.push(`${error.message} @ ${page.url()} ${error.stack?.split('\n')[1] ?? ''}`),
    );

    const scrollOnce = () =>
        page.evaluate(() => {
            const image = document.querySelector('img[alt^="Page #"]');
            let scroller = image?.parentElement;
            while (scroller && getComputedStyle(scroller).overflowY !== 'auto') {
                scroller = scroller.parentElement;
            }
            scroller?.scrollBy({ top: 1_000_000 });
        });
    // Pages still loading grow the chapter: scroll again until it stops growing.
    const scrollToEnd = async () => {
        for (let attempt = 0; attempt < 6; attempt += 1) {
            // oxlint-disable-next-line no-await-in-loop
            await scrollOnce();
            // oxlint-disable-next-line no-await-in-loop
            await page.waitForTimeout(500);
        }
    };
    const waitForPages = (count) =>
        page
            .waitForFunction((wanted) => document.querySelectorAll('img[alt^="Page #"]').length >= wanted, count, {
                timeout: 15_000,
            })
            .catch(() => {});
    const readerUrlOf = (chapter) => `${ORIGIN}/manga/${chapter.mangaId}/chapter/${chapter.sourceOrder}`;
    const en = (number, scanlator = 'Unofficial') =>
        enChapters.find((chapter) => chapter.chapterNumber === number && chapter.scanlator === scanlator);

    // Series page: the art-match line and its report.
    await page.goto(`${ORIGIN}/manga/${EN_ID}`);
    const alignLine = page.getByText('✓ Raw matches English (Asura 224 = raw 224)');
    await alignLine.waitFor({ timeout: 20_000 }).catch(() => {});
    check(label('series: "✓ Raw matches English (Asura 224 = raw 224)"'), await alignLine.isVisible(), {});
    await page
        .getByRole('button', { name: 'details' })
        .click()
        .catch(() => {});
    const report = page.getByRole('dialog', { name: 'Raw vs English: art match' });
    await report
        .getByText('boiler skipped')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const reportText = await report.innerText().catch(() => '');
    check(
        label('details: the report formatted (skipped cards, candidates table with score / overlap)'),
        reportText.includes('boiler skipped') && reportText.includes('overlap') && reportText.includes('0.889'),
        { reportText: reportText.slice(0, 200) },
    );
    await page.keyboard.press('Escape');

    // Chapter list: MTL 225 inline between 226 and 224, badged; Missing row for 227 / 228 with actions.
    /** MTL badges on chapter rows (the series chips also say "MTL"). */
    const mtlBadges = () => page.locator('a .MuiChip-root', { hasText: /^MTL$/ }).count();
    const listText = async () => (await page.locator('body').innerText()).replaceAll(/\s+/g, ' ');
    await page
        .locator('a .MuiChip-root', { hasText: /^MTL$/ })
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    const text = await listText();
    check(
        label('inline MTL 225 between 226 and 224 (filter: unofficial), with an MTL badge'),
        (await mtlBadges()) === 1 &&
            text.indexOf('Chapter 226') < text.indexOf('Chapter 225') &&
            text.indexOf('Chapter 225') < text.indexOf('Chapter 224'),
        { order: text.match(/Chapter 22\d/g) },
    );
    const missing = page.getByRole('group', { name: 'Chapter 227' });
    await missing.waitFor({ timeout: 10_000 }).catch(() => {});
    check(
        label('Missing row lists 227 and 228, each with Translate & read / Read raw / Compare'),
        (await missing
            .getByRole('button', { name: 'Translate & read' })
            .isVisible()
            .catch(() => false)) &&
            (await missing
                .getByRole('button', { name: 'Read raw' })
                .isVisible()
                .catch(() => false)) &&
            (await missing
                .getByRole('button', { name: 'Compare' })
                .isVisible()
                .catch(() => false)) &&
            (await page
                .getByRole('group', { name: 'Chapter 228' })
                .isVisible()
                .catch(() => false)),
        {},
    );
    // Chapter menu of 224.
    const row224 = page.locator('a', { hasText: 'Chapter 224' }).first();
    await row224
        .getByRole('button', { name: 'more' })
        .click()
        .catch(() => {});
    const menu = page.getByRole('menu');
    await menu.waitFor({ timeout: 5000 }).catch(() => {});
    const menuText = await menu.innerText().catch(() => '');
    check(
        label('chapter menu: Read raw, Translate raw (MTL), Compare with raw'),
        ['Read raw', 'Translate raw (MTL)', 'Compare with raw'].every((item) => menuText.includes(item)),
        { menuText },
    );
    await page.keyboard.press('Escape');

    // Reader, unofficial 224: the end card, "Read MTL 225" without a request.
    await page.goto(readerUrlOf(en(224)));
    await waitForPages(EN_PAGES);
    await scrollToEnd();
    const card = page.getByRole('group', { name: 'Chapter 225' });
    await card.waitFor({ timeout: 10_000 }).catch(() => {});
    const cardText = await card.innerText().catch(() => '');
    check(
        label(
            'end of 224: "Ch 225 isn\'t in English yet. Raw is out (如漫画)." and "✓ Raw 225 follows Asura 224 (art match)"',
        ),
        cardText.includes("Ch 225 isn't in English yet. Raw is out (如漫画).") &&
            cardText.includes('✓ Raw 225 follows Asura 224 (art match)'),
        { cardText },
    );
    check(
        label('"There is no next chapter" gives way to the card'),
        (await page.getByText('There is no next chapter').count()) === 0,
        {},
    );
    const readMtl = card.getByRole('button', { name: 'Read MTL 225' });
    check(label('MTL 225 done: "Read MTL 225", no request'), await readMtl.isVisible().catch(() => false), {
        requests: engine.requests,
    });
    await readMtl.click().catch(() => {});
    await page.waitForURL(`**/manga/${MTL_ID}/chapter/1`, { timeout: 10_000 }).catch(() => {});
    check(label('opens MTL 225'), page.url().endsWith(`/manga/${MTL_ID}/chapter/1`), { url: page.url() });
    check(
        label('nothing was requested for 225'),
        !engine.requests.some((request) => request.includes(':225:')),
        engine.requests,
    );

    // Next from MTL 225: unofficial 226.
    await waitForPages(EN_PAGES);
    await scrollToEnd();
    if (process.env.E2E_SHOTS) {
        await page.waitForTimeout(3000);
        await page.screenshot({ path: `${process.env.E2E_SHOTS}/mtl225.png` });
        console.log('BODY', (await page.locator('body').innerText()).slice(0, 800));
        console.log(
            'IMGS',
            await page.evaluate(() =>
                [...document.querySelectorAll('img')].map((img) => `${img.alt}:${img.naturalHeight}`).join(','),
            ),
        );
        (await import('node:fs')).writeFileSync(`${process.env.E2E_SHOTS}/mtl.html`, await page.content());
        console.log('DBG', await page.evaluate(() => JSON.stringify(window.tsujiDebug)));
        console.log('LS', await page.evaluate(() => Object.keys(localStorage).filter((key) => key.includes('raws'))));
    }
    const nextInEnglish = page
        .getByRole('status')
        .filter({ hasText: 'The next chapter is in English.' })
        .getByRole('button', { name: 'Next chapter' });
    await page
        .getByText('The next chapter is in English.')
        .waitFor({ timeout: 10_000 })
        .catch(() => {});
    await nextInEnglish.click().catch(() => {});
    await page.waitForURL(`**/manga/${EN_ID}/chapter/${en(226).sourceOrder}`, { timeout: 10_000 }).catch(() => {});
    check(
        label('Next from MTL 225 opens unofficial 226'),
        page.url().endsWith(`/manga/${EN_ID}/chapter/${en(226).sourceOrder}`),
        {
            url: page.url(),
        },
    );

    // End of 226: 227 only on the raw. Translate & read.
    await waitForPages(EN_PAGES);
    await page.evaluate(() => {
        window.tsujiNoReload = true;
    });
    // 229 follows 226 in infinite scroll: stop at the end of 226 (its last page at the bottom of the window).
    for (let attempt = 0; attempt < 6; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop
        await page.evaluate((pages) => {
            document.querySelector(`img[alt="Page #${pages}"]`)?.scrollIntoView({ block: 'end' });
        }, EN_PAGES);
        // oxlint-disable-next-line no-await-in-loop
        await page.waitForTimeout(500);
    }
    const card227 = page.getByRole('group', { name: 'Chapter 227' });
    await card227.waitFor({ timeout: 10_000 }).catch(() => {});
    check(
        label('end of 226: the verdict as a warning (the match confirms 225, not 227)'),
        (await card227.innerText().catch(() => '')).includes(`⚠ ${VERDICT}`),
        { text: await card227.innerText().catch(() => '') },
    );
    await card227
        .getByRole('button', { name: 'Translate & read' })
        .click()
        .catch(() => {});
    await card227
        .getByText(/Queued/)
        .waitFor({ timeout: 8000 })
        .catch(() => {});
    const sawQueued = await card227
        .getByText(/Queued/)
        .isVisible()
        .catch(() => false);
    await card227
        .getByText(`2 / ${FULL_PAGES} pages`, { exact: false })
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    const sawCounter = await page
        .getByText(`Translating… 2 / ${FULL_PAGES} pages · 1:35`)
        .isVisible()
        .catch(() => false);
    check(label('Translate & read: queued, then "Translating… 2 / 9 pages · 1:35"'), sawQueued && sawCounter, {
        sawQueued,
        sawCounter,
        requests: engine.requests,
    });
    await page.waitForURL(`**/manga/${MTL_ID}/chapter/2`, { timeout: 15_000 }).catch(() => {});
    check(label('the MTL chapter opens by itself once readable'), page.url().endsWith(`/manga/${MTL_ID}/chapter/2`), {
        url: page.url(),
    });

    // The partial chapter: its note at the end, then the full page list without a reload.
    await waitForPages(PARTIAL_PAGES);
    await scrollToEnd();
    const note = page.getByText(
        `Pages ${PARTIAL_PAGES + 1}-${FULL_PAGES} are still being translated… (${PARTIAL_PAGES} / ${FULL_PAGES})`,
    );
    await note.waitFor({ timeout: 10_000 }).catch(() => {});
    check(
        label('partial chapter: "Pages 4-9 are still being translated… (3 / 9)"'),
        await note.isVisible().catch(() => false),
        {},
    );
    // Read on to the middle of the last partial page (r3443: the full list reset the reader to page 1).
    await page.evaluate((pages) => {
        document.querySelector(`img[alt="Page #${pages}"]`)?.scrollIntoView({ block: 'start' });
    }, PARTIAL_PAGES);
    await waitForPages(FULL_PAGES);
    await page.waitForTimeout(2500);
    const pagesShown = await page.locator('img[alt^="Page #"]').count();
    check(
        label('ready: the full page list (9) in place, no reload'),
        pagesShown >= FULL_PAGES && (await page.evaluate(() => window.tsujiNoReload === true)),
        { pagesShown, mtlPages: mtlEntry.pageCount },
    );
    const place = await page.evaluate((pages) => {
        const [first, last] = ['Page #1', `Page #${pages}`].map(
            (alt) => document.querySelector(`img[alt="${alt}"]`)?.getBoundingClientRect().top ?? null,
        );
        return { first, last, viewport: window.innerHeight };
    }, PARTIAL_PAGES);
    check(
        label('ready: still on page 3 (not back to page 1)'),
        place.last !== null && Math.abs(place.last) < 50 && place.first !== null && place.first < -1000,
        place,
    );

    // MTL 225 opened directly, without the 224 card (r3443: Next went to MTL 226): the English series is found.
    await page.evaluate(() =>
        Object.keys(localStorage)
            .filter((key) => key.includes('raws:mtl'))
            .forEach((key) => localStorage.removeItem(key)),
    );
    await page.goto(`${ORIGIN}/manga/${MTL_ID}/chapter/1`);
    await waitForPages(EN_PAGES);
    await scrollToEnd();
    const directNext = page
        .getByRole('status')
        .filter({ hasText: 'The next chapter is in English.' })
        .getByRole('button', { name: 'Next chapter' });
    // The English series is looked up first (one library query): give a loaded machine time, scrolling again.
    for (let attempt = 0; attempt < 4; attempt += 1) {
        // oxlint-disable-next-line no-await-in-loop
        if (await directNext.isVisible().catch(() => false)) {
            break;
        }
        // oxlint-disable-next-line no-await-in-loop
        await directNext.waitFor({ timeout: 5000 }).catch(() => {});
        // oxlint-disable-next-line no-await-in-loop
        await scrollToEnd();
    }
    await directNext.click().catch(() => {});
    await page.waitForURL(`**/manga/${EN_ID}/chapter/${en(226).sourceOrder}`, { timeout: 10_000 }).catch(() => {});
    check(
        label('MTL 225 opened directly: Next is unofficial 226'),
        page.url().endsWith(`/manga/${EN_ID}/chapter/${en(226).sourceOrder}`),
        { url: page.url() },
    );

    // A bad signature: "Couldn't request a translation", once.
    await page.goto(`${ORIGIN}/manga/${BAD_EN_ID}/chapter/1`);
    await waitForPages(EN_PAGES);
    await scrollToEnd();
    const badCard = page.getByRole('group', { name: 'Chapter 2' });
    await badCard
        .getByRole('button', { name: 'Translate & read' })
        .click({ timeout: 10_000 })
        .catch(() => {});
    await badCard
        .getByText("Couldn't request a translation.")
        .waitFor({ timeout: 8000 })
        .catch(() => {});
    const pollsBefore = engine.polls[`${BAD_RAW_ID}:2`] ?? 0;
    await page.waitForTimeout(7000);
    check(
        label('bad signature: "Couldn\'t request a translation.", one request, no polling loop'),
        (await badCard
            .getByText("Couldn't request a translation.")
            .isVisible()
            .catch(() => false)) &&
            engine.requests.filter((request) => request.startsWith(`${BAD_RAW_ID}:`)).length === 1 &&
            (engine.polls[`${BAD_RAW_ID}:2`] ?? 0) === pollsBefore,
        { requests: engine.requests, polls: engine.polls },
    );

    // Filter on the official copy (it has 225): the MTL row goes.
    server.mangaMeta.set('webUI_excludedScanlators', JSON.stringify(['Unofficial']));
    await page.goto(`${ORIGIN}/manga/${EN_ID}`);
    await page
        .getByText('Chapter 224')
        .first()
        .waitFor({ timeout: 15_000 })
        .catch(() => {});
    await page.waitForTimeout(1500);
    const mtlRows = await page
        .locator('a', { has: page.locator('.MuiChip-root', { hasText: /^MTL$/ }) })
        .allInnerTexts();
    check(
        label('filter on official (has 225): no MTL 225 row; MTL 227 stays (official has no 227)'),
        mtlRows.length === 1 && mtlRows[0].includes('Chapter 227'),
        { mtlRows },
    );

    // Other features' hosts (fonts, AniList for Similar) aside: this feature adds only the relay, and only /mtl/.
    const knownHosts = [
        ORIGIN,
        RELAY,
        'https://fonts.googleapis.com',
        'https://fonts.gstatic.com',
        'https://graphql.anilist.co',
    ];
    check(
        label('no new hosts besides the relay from the meta; relay calls are /mtl/ only'),
        [...hosts].every((host) => knownHosts.includes(host)) && relayPaths.every((path) => path.startsWith('/mtl/')),
        { hosts: [...hosts], relayPaths: [...new Set(relayPaths)] },
    );
    // Meta keys this feature could touch (other features' own writes, e.g. the read scanlator, aside).
    const metaWrites = server.mutationLog.filter(
        ({ name, args }) =>
            /meta/i.test(name) && /"key":"[^"]*(raw|mtl|align|translat)[^"]*"/i.test(JSON.stringify(args)),
    );
    check(label('nothing written to Suwayomi meta by this feature'), metaWrites.length === 0, metaWrites);
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
