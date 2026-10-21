/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of "Compare translations" (brief #16) on the production build, mocked Suwayomi only: the card from
// the live result of The Game That I Came From (3526), "Read <variant>" through the chapter list's scanlator filter
// and "Show all"; on a series with no result, the request (global meta) and the card appearing without a reload
// once the result lands; no card for a single upload; a v1 result offers only "Re-check".
//
// Usage: pnpm build && node tools/scripts/tsuji/tl-compare.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

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

/** The live value for The Game That I Came From (3526), 2026-10-21. */
const LIVE_3526 =
    '{"v":2,"at":1792614714,"source":"MangaFire (EN)","status":"ok","sampled":[1,51,101,151,200,251,301,351],"variants":[{"name":"unofficial","group":"Asura Scans / Manhwa Freak / UTOON (re-upload site)","groupHits":38,"groupByCh":[[1,"Asura Scans"],[51,"Asura Scans"],[101,"Asura Scans"],[151,"Asura Scans"],[200,"Asura Scans"],[251,"Manhwa Freak"],[301,"UTOON (re-upload site)"],[351,"UTOON (re-upload site) / AcloudMerge (re-upload site) / ColaManga (re-upload site)"]],"chapters":359,"widthMin":201,"widthMax":1280,"pagesAvg":78.2,"words":5467,"tn":3},{"name":"official","group":"WebComics app / Kuaikan","groupHits":36,"groupByCh":[[1,"Kuaikan"],[51,"Kuaikan"],[101,"Kuaikan"],[151,"Kuaikan"],[200,"Kuaikan"],[251,"Kuaikan"],[301,"Kagane (re-upload site) / Kuaikan"],[351,"WebComics app"]],"chapters":351,"widthMin":800,"widthMax":1280,"pagesAvg":82.4,"words":6097,"tn":0}],"terms":[{"a":"awakened","b":"awakener","countA":11,"countB":5,"driftA":[],"driftB":[]}],"onlyA":[{"w":"heavenland","n":8,"other":0},{"w":"thousand","n":7,"other":0},{"w":"slimes","n":6,"other":0},{"w":"narlo","n":5,"other":0},{"w":"autumns","n":5,"other":0},{"w":"site","n":5,"other":0}],"onlyB":[{"w":"tianyong","n":9,"other":0},{"w":"land","n":9,"other":0},{"w":"rumble","n":7,"other":0},{"w":"tiris","n":7,"other":0},{"w":"president","n":6,"other":0},{"w":"daggers","n":5,"other":0}],"secs":0}';

const chapter = (mangaId, id, number, scanlator) => ({
    id,
    mangaId,
    name: `Chapter ${number} (${scanlator})`,
    chapterNumber: number,
    sourceOrder: id,
    scanlator,
    isRead: false,
    isBookmarked: false,
    isDownloaded: false,
    lastPageRead: 0,
    pageCount: 1,
    uploadDate: '0',
    fetchedAt: '0',
    lastReadAt: '0',
    url: '',
});

/** A series with these uploads (scanlators), 3 chapters each, and its manga meta. */
const createServer = (mangaId, title, scanlators, mangaMeta = {}) => {
    const server = createMockSuwayomi({
        manga: {
            id: mangaId,
            title,
            sourceId: '1',
            inLibrary: false,
            genre: [],
            description: 'A test series.',
            source: { id: '1', name: 'MangaFire (EN)', displayName: 'MangaFire (EN)' },
        },
        chapters: scanlators
            .flatMap((scanlator, index) =>
                [1, 2, 3].map((number) => chapter(mangaId, mangaId * 100 + index * 10 + number, number, scanlator)),
            )
            .reverse(),
        pageCount: 1,
    });
    Object.entries(mangaMeta).forEach(([key, value]) => server.mangaMeta.set(key, value));
    return server;
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
    let server = null;
    const hosts = new Set();

    const context = await browser.newContext({ viewport: { width: 1280, height: 1000 } });
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.origin !== ORIGIN) {
            hosts.add(url.host);
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
    const page = await context.newPage();
    const pageErrors = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    const card = page.getByRole('region', { name: 'Compare translations' });
    const chapterRows = () =>
        page
            .getByText(/^Chapter \d \((official|unofficial)\)$/)
            .evaluateAll((items) => items.map((item) => item.textContent));

    // 1. 3526: the card from the live result.
    server = createServer(3526, 'The Game That I Came From', ['unofficial', 'official'], {
        tsuji_tlCompare: LIVE_3526,
    });
    await page.goto(`${ORIGIN}/manga/3526`);
    await card.waitFor({ timeout: 20_000 }).catch(() => {});
    const text = (await card.innerText().catch(() => '')).replaceAll(/\s+/g, ' ');
    const expected = [
        'Two English versions on MangaFire (EN)',
        'unofficial · Asura Scans',
        'official · WebComics app',
        'Asura Scans / Manhwa Freak / UTOON (re-upload site)',
        'WebComics app / Kuaikan',
        'ch 1-200 Asura Scans · 251 Manhwa Freak · 301-351 UTOON (re-upload site)',
        'ch 1-251 Kuaikan · 301 Kagane (re-upload site) · 351 WebComics app',
        '“awakened”',
        '“awakener”',
        'heavenland ×8',
        'tianyong ×9',
        '3 in 8 chapters',
        'none',
        '201-1280 px',
        '800-1280 px',
        '359',
        '351',
        'Sampled ch 1, 51, 101, 151, 200, 251, 301, 351',
        "one-off wording slips in other chapters won't show here",
        'Re-check',
    ];
    check(
        label('3526: the card with the live values'),
        expected.every((part) => text.includes(part)),
        expected.filter((part) => !text.includes(part)),
    );
    const muted = await card
        .getByText('UTOON (re-upload site)', { exact: true })
        .first()
        .evaluate((element) => getComputedStyle(element).color)
        .catch(() => null);
    const normal = await card
        .getByText('Manhwa Freak', { exact: true })
        .first()
        .evaluate((element) => getComputedStyle(element).color)
        .catch(() => null);
    check(label('a re-upload site is muted'), !!muted && muted !== normal, { muted, normal });

    // 2. Read unofficial: the chapter list follows it; Show all restores.
    const before = await chapterRows();
    const writesBefore = server.mutationLog.length;
    await card.getByRole('button', { name: 'Read unofficial' }).click();
    await page
        .getByText('Showing only unofficial chapters')
        .waitFor({ timeout: 5000 })
        .catch(() => {});
    await page.waitForTimeout(500);
    const onlyUnofficial = await chapterRows();
    const metaWrites = server.mutationLog.slice(writesBefore).filter(({ name }) => /Meta/i.test(name));
    check(
        label('Read unofficial: only unofficial chapters; only excludedScanlators written'),
        before.length === 6 &&
            onlyUnofficial.length === 3 &&
            onlyUnofficial.every((row) => row.includes('(unofficial)')) &&
            metaWrites.length > 0 &&
            metaWrites.every(({ args }) => JSON.stringify(args).includes('excludedScanlators')) &&
            JSON.stringify(metaWrites.at(-1).args).includes('official'),
        { before: before.length, onlyUnofficial, metaWrites: metaWrites.map(({ name, args }) => [name, args]) },
    );
    check(
        label('the active version is highlighted'),
        (await card.getByRole('button', { name: 'Read unofficial' }).getAttribute('class'))?.includes('contained'),
        {},
    );
    await card.getByRole('button', { name: 'Show all' }).click();
    await page.waitForTimeout(500);
    check(
        label('Show all: every chapter again'),
        (await chapterRows()).length === 6 && !(await page.getByText('Showing only unofficial chapters').count()),
        await chapterRows(),
    );

    // 3. No result yet, two uploads: ask, keep the page open, the card lands without a reload.
    server = createServer(77, 'Two Uploads', ['official', 'unofficial']);
    await page.goto(`${ORIGIN}/manga/77`);
    const compareButton = page.getByRole('button', { name: 'Compare translations' });
    await compareButton.waitFor({ timeout: 20_000 }).catch(() => {});
    const hadButton = await compareButton.isVisible();
    await compareButton.click().catch(() => {});
    await page
        .getByText('Checking… up to 30 min. You can keep browsing.')
        .waitFor({ timeout: 5000 })
        .catch(() => {});
    const requested = Number(server.meta.get('tsuji_tlRequest_77'));
    check(
        label('Compare translations: the request is written (global meta), "Checking…" shown'),
        hadButton &&
            Number.isFinite(requested) &&
            Math.abs(requested - Date.now() / 1000) < 60 &&
            (await page.getByText('Checking… up to 30 min. You can keep browsing.').isVisible()),
        { requested },
    );
    // The service answers: result written, request removed.
    const answer = JSON.parse(LIVE_3526);
    answer.at = Math.floor(Date.now() / 1000) + 5;
    answer.variants[0].name = 'official';
    answer.variants[1].name = 'unofficial';
    server.mangaMeta.set('tsuji_tlCompare', JSON.stringify(answer));
    server.meta.delete('tsuji_tlRequest_77');
    const landedAt = Date.now();
    await card.waitFor({ timeout: 45_000 }).catch(() => {});
    check(
        label('the card appears without a reload (polled every 30 s)'),
        (await card.isVisible()) && Date.now() - landedAt < 45_000,
        { waitedMs: Date.now() - landedAt },
    );

    // 4. One upload: nothing.
    server = createServer(78, 'One Upload', ['official']);
    await page.goto(`${ORIGIN}/manga/78`);
    await page
        .getByText('Chapter 1 (official)')
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1000);
    check(
        label('a single upload: no card, no button'),
        !(await card.count()) && !(await page.getByRole('button', { name: 'Compare translations' }).count()),
        {},
    );

    // 5. A v1 result: only Re-check.
    server = createServer(79, 'Old Result', ['official', 'unofficial'], {
        tsuji_tlCompare: JSON.stringify({ v: 1, at: 1_790_000_000, status: 'ok', variants: [{}, {}] }),
    });
    await page.goto(`${ORIGIN}/manga/79`);
    await page
        .getByText('Chapter 1 (official)')
        .waitFor({ timeout: 20_000 })
        .catch(() => {});
    await page.waitForTimeout(1000);
    check(
        label('a v1 result: only the Re-check link'),
        !(await card.count()) && (await page.getByRole('button', { name: 'Re-check translations' }).isVisible()),
        {},
    );

    check(
        label('no host but Suwayomi for this feature (others are the page’s usual AniList / relay calls)'),
        ![...hosts].some((host) => /tlcompare|vm110/i.test(host)),
        [...hosts],
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
