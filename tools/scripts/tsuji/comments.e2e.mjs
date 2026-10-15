/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Browser test of reader comments (production build, mocked Suwayomi, a fake comments relay on the WebUI host's
// port 4568 answering like Comick). Checks the series pill opens chapter 1's thread in a right drawer (spoiler chips,
// quote blocks, collapsed replies, plain text only), caches hold on reopen, the reader button shows the current
// chapter's thread, a series without a match offers a search whose pick is merged into tsuji_commentsMatch, the
// relay being down or hanging shows one line with Retry after a single request (5 s timeout), a phone gets a
// bottom sheet, and the master switch hides the pill.
//
// Usage: pnpm build && node tools/scripts/tsuji/comments.e2e.mjs   (E2E_BROWSERS=chrome,firefox for both)

import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';
import { chromium, firefox } from 'playwright-core';
import { createMockSuwayomi } from './mockSuwayomi.mjs';

const BUILD_DIR = resolve(process.env.BUILD_DIR ?? 'build');
/** Set to a folder to save screenshots of the panel (desktop drawer, phone sheet). */
const SCREENSHOT_DIR = process.env.E2E_SCREENSHOTS;
const ORIGIN = 'http://suwayomi.test';
const RELAY_HOST = 'suwayomi.test:4568';
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
const FILLER_COUNT = 55;
const LAST_CHAPTER = 150;

/**
 * Suwayomi's chapters: 1, two scanlator copies of 2 (A, then B), the extra 2.5 (Comick doesn't have it), then 3 ..
 * 150. Source order follows that list, so /chapter/2 in the reader is chapter 2 from A.
 */
const SERIES_CHAPTERS = [
    { chapterNumber: 1, scanlator: 'A', name: 'Chapter 1' },
    { chapterNumber: 2, scanlator: 'A', name: 'Chapter 2 - The Devil Seeker' },
    { chapterNumber: 2, scanlator: 'B', name: 'Chapter 2 - Devil Seeker (B)' },
    { chapterNumber: 2.5, scanlator: 'A', name: 'Chapter 2.5 - Extra' },
    ...Array.from({ length: LAST_CHAPTER - 2 }, (_, index) => ({
        chapterNumber: index + 3,
        scanlator: 'A',
        name: `Chapter ${index + 3}`,
    })),
].map((chapter, index) => ({ ...chapter, sourceOrder: index + 1 }));

const comment = (id, content, extra = {}) => ({
    id,
    content,
    up_count: 3,
    created_at: new Date(Date.now() - 2 * 86_400_000).toISOString(),
    identities: { traits: { username: `user${id}` } },
    other_comments: [],
    ...extra,
});

/** Fake relay: Comick's API under /comick, counting requests per path. */
const createRelay = () => {
    const counts = {};
    const series = {
        'Comments Test': { id: 77, hid: 'ctest', title: 'Comments Test' },
        'Other Name': { id: 88, hid: 'other', title: 'Other Name' },
    };
    const chapters = {
        ctest: [
            { hid: 'c1-low', chap: '1', up_count: 1 },
            { hid: 'c1-top', chap: '1', up_count: 10 },
            { hid: 'c2', chap: '2', up_count: 4 },
            ...Array.from({ length: LAST_CHAPTER - 2 }, (_, index) => ({
                hid: `c${index + 3}`,
                chap: String(index + 3),
            })),
        ],
        other: [{ hid: 'o1', chap: '1', up_count: 1 }],
    };
    const threads = {
        'c1-top': [
            comment(1, 'First ||the twist|| here\n> quoted line\nmy reply to it', {
                up_count: 12,
                other_comments: [comment(2, 'a reply below')],
            }),
            comment(3, '<b>not bold</b> [a link](https://example.com)'),
            ...Array.from({ length: FILLER_COUNT }, (_, index) => comment(100 + index, `Filler ${index}`)),
        ],
        c2: [comment(10, 'Chapter two talk')],
        c3: [comment(11, 'Chapter three talk')],
        c100: [comment(12, 'Chapter hundred talk')],
        [`c${LAST_CHAPTER}`]: [comment(13, 'Last chapter talk')],
        o1: [comment(20, 'Other series talk')],
    };

    const answer = (url) => {
        const path = url.pathname.replace(/^\/comick/, '');
        counts[path] = (counts[path] ?? 0) + 1;
        if (path === '/v1.0/search') {
            const hit = series[url.searchParams.get('q')];
            return hit ? [hit] : [{ id: 1, hid: 'nope', title: 'Nothing Alike At All' }];
        }
        const chapterList = path.match(/^\/comic\/([^/]+)\/chapters$/);
        if (chapterList) {
            return chapters[chapterList[1]] ? { chapters: chapters[chapterList[1]] } : null;
        }
        const thread = path.match(/^\/comment\/chapter\/([^/]+)$/);
        if (thread) {
            return threads[thread[1]] ? { comments: threads[thread[1]] } : null;
        }
        return null;
    };

    return {
        counts,
        answer,
        /** Requests the relay never answered ('refused', 'hung'). */
        count: (name) => {
            counts[name] = (counts[name] ?? 0) + 1;
        },
        total: () => Object.values(counts).reduce((sum, count) => sum + count, 0),
    };
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
    'access-control-allow-methods': 'GET, POST, OPTIONS',
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

const createServer = (title, globalMeta = {}) =>
    createMockSuwayomi({
        manga: {
            id: MANGA_ID,
            title,
            sourceId: '1',
            inLibrary: true,
            genre: [],
            source: { id: '1', name: 'Local source', displayName: 'Local source' },
        },
        chapters: SERIES_CHAPTERS.map(({ chapterNumber, scanlator, name, sourceOrder }) => ({
            id: 900 + sourceOrder,
            mangaId: MANGA_ID,
            name,
            chapterNumber,
            sourceOrder,
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
        })).reverse(),
        pageCount: 1,
        globalMeta,
    });

/**
 * `relayMode()` decides per request: 'up' answers, 'down' refuses the connection, 'hang' answers after 8 s (past the
 * WebUI's 5 s timeout).
 */
const openContext = async (browser, { server, relay, relayMode = () => 'up', contextOptions }) => {
    const context = await browser.newContext(contextOptions);
    await context.route('**/*', async (route) => {
        const request = route.request();
        const url = new URL(request.url());
        if (url.host === RELAY_HOST) {
            const mode = relayMode();
            if (mode === 'down') {
                relay.count('refused');
                return route.abort('connectionrefused');
            }
            if (mode === 'hang') {
                relay.count('hung');
                await new Promise((done) => {
                    setTimeout(done, 8000);
                });
                return route.fulfill({ status: 504, headers: CORS, body: '' }).catch(() => {});
            }
            const body = relay.answer(url);
            return route.fulfill({
                status: body === null ? 404 : 200,
                headers: { ...CORS, 'content-type': 'application/json' },
                body: JSON.stringify(body ?? {}),
            });
        }
        if (url.host === 'graphql.anilist.co') {
            if (request.method() === 'OPTIONS') {
                return route.fulfill({ status: 204, headers: CORS });
            }
            return route.fulfill({
                status: 200,
                headers: { ...CORS, 'content-type': 'application/json' },
                body: JSON.stringify({ data: {} }),
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
    const page = await context.newPage();
    const pageErrors = [];
    const consoleNoise = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    page.on('console', (message) => {
        // The browser's own network log for a refused request (Chrome "Failed to load resource", Firefox "CORS
        // request did not succeed") is not the app's: only the app logging relay errors counts as noise.
        const isBrowserNetworkLog = /Failed to load resource|Cross-Origin Request Blocked|net::ERR_/.test(
            message.text(),
        );
        if (!isBrowserNetworkLog && /CommentsRelayError|comick/i.test(message.text())) {
            consoleNoise.push(message.text());
        }
    });
    return { context, page, pageErrors, consoleNoise };
};

const panelOf = (page) => page.getByRole('dialog', { name: 'Comments' });

const selectorOf = (panel) => ({
    chooser: panel.getByRole('button', { name: 'Choose chapter' }),
    previous: panel.getByRole('button', { name: 'Previous chapter' }),
    next: panel.getByRole('button', { name: 'Next chapter' }),
});

const waitText = (scope, text) =>
    scope
        .getByText(text)
        .first()
        .waitFor({ timeout: 10_000 })
        .catch(() => {});

const isShown = (scope, text) =>
    scope
        .getByText(text)
        .first()
        .isVisible()
        .catch(() => false);

const chapterRow = (page, name) => page.locator('.MuiCard-root', { hasText: name }).first();

const openPill = async (page) => {
    const pill = page.getByRole('button', { name: 'Comments', exact: true });
    await pill.waitFor({ timeout: 20_000 });
    await pill.click();
    const panel = panelOf(page);
    await panel.waitFor({ timeout: 5000 });
    return panel;
};

const runBrowser = async (browserName) => {
    const browser = await launchers[browserName]();
    const label = (text) => `[${browserName}] ${text}`;

    let rowHeightWithButton = null;

    // 1. Desktop, matched series: the pill opens chapter 1's thread.
    {
        const server = createServer('Comments Test');
        const relay = createRelay();
        const { context, page, pageErrors, consoleNoise } = await openContext(browser, {
            server,
            relay,
            contextOptions: { viewport: { width: 1280, height: 900 } },
        });
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
        const panel = await openPill(page);
        await panel
            .getByText('First', { exact: false })
            .first()
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        const text = await panel.innerText();

        const box = await panel.boundingBox();
        check(
            label('desktop: right drawer about 420 px wide'),
            box && box.x > 800 && Math.abs(box.width - 420) < 4,
            box,
        );
        check(label('chapter 1 thread from the most up-voted scanlation'), text.includes('First'), {
            counts: relay.counts,
        });
        check(label('match shown'), text.includes('Comick: Comments Test') && text.includes('Wrong series?'), {});
        check(label('comment count'), text.includes(`${FILLER_COUNT + 2} comments`), {});

        const spoiler = panel.getByRole('button', { name: 'Spoiler, tap to reveal' });
        check(label('spoiler is a hidden chip'), (await spoiler.count()) === 1, {});
        await spoiler.click();
        check(
            label('spoiler reveals on tap'),
            (await panel.locator('button[aria-pressed="true"]', { hasText: 'the twist' }).count()) === 1,
            {},
        );
        check(
            label('> line is a quote block'),
            (await panel.locator('blockquote', { hasText: 'quoted line' }).count()) === 1,
            {},
        );
        check(
            label('HTML stays text, links become their label'),
            text.includes('<b>not bold</b> a link') &&
                (await panel.locator('b').count()) === 0 &&
                (await panel.locator('a[href]').count()) === 0,
            {},
        );

        check(label('replies collapsed'), !text.includes('a reply below'), {});
        await panel.getByRole('button', { name: '1 reply' }).click();
        check(label('"1 reply" expands'), await panel.getByText('a reply below').isVisible(), {});
        if (SCREENSHOT_DIR) {
            await page.screenshot({ path: join(SCREENSHOT_DIR, `comments-desktop-${browserName}.png`) });
        }

        const more = panel.getByRole('button', { name: /^Show more/ });
        check(label('first 50 shown, "Show more" for the rest'), (await more.textContent()) === 'Show more (7)', {});
        await more.click();
        check(label('"Show more" shows the rest'), await panel.getByText(`Filler ${FILLER_COUNT - 1}`).isVisible(), {});

        check(
            label('3 relay requests: search, chapter map, thread'),
            relay.counts['/v1.0/search'] === 1 &&
                relay.counts['/comic/ctest/chapters'] === 1 &&
                relay.counts['/comment/chapter/c1-top'] === 1 &&
                relay.total() === 3,
            relay.counts,
        );

        await panel.getByRole('button', { name: 'Close' }).click();
        await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
        await openPill(page);
        await panelOf(page)
            .getByText('First')
            .first()
            .waitFor({ timeout: 5000 })
            .catch(() => {});
        check(label('reopen within 2 min: everything from the caches'), relay.total() === 3, relay.counts);

        // Brief #5.1: the chapter selector.
        {
            const live = panelOf(page);
            const { chooser, previous, next } = selectorOf(live);
            check(
                label('selector: < Ch. 1 >, previous disabled at the first chapter'),
                (await chooser.textContent()) === 'Ch. 1' && (await previous.isDisabled()) && (await next.isEnabled()),
                { label: await chooser.textContent() },
            );
            await next.click();
            await waitText(live, 'Chapter two talk');
            check(
                label('next: chapter 2 (twins are one entry, labelled from the first copy), its thread loads'),
                (await chooser.textContent()) === 'Ch. 2 - The Devil Seeker' &&
                    (await isShown(live, 'Chapter two talk')),
                { label: await chooser.textContent() },
            );
            await next.click();
            await waitText(live, 'Comick has no thread for chapter 2.5');
            check(
                label('a number Comick lacks (2.5): "no thread", no other chapter shown'),
                (await isShown(live, 'Comick has no thread for chapter 2.5')) &&
                    !(await isShown(live, 'Chapter two talk')) &&
                    !(await isShown(live, 'Chapter three talk')) &&
                    (await chooser.textContent()) === 'Ch. 2.5 - Extra',
                { label: await chooser.textContent() },
            );
            check(
                label('arrows still work on "no thread"'),
                (await previous.isEnabled()) && (await next.isEnabled()),
                {},
            );

            await chooser.focus();
            await page.keyboard.press('ArrowRight');
            await waitText(live, 'Chapter three talk');
            check(label('ArrowRight in the panel steps to chapter 3'), await isShown(live, 'Chapter three talk'), {
                label: await chooser.textContent(),
            });
            await page.keyboard.press('ArrowLeft');
            await waitText(live, 'Comick has no thread for chapter 2.5');
            check(label('ArrowLeft steps back'), (await chooser.textContent()) === 'Ch. 2.5 - Extra', {
                label: await chooser.textContent(),
            });

            await chooser.click();
            const picker = page.getByRole('dialog', { name: 'Choose chapter' });
            await picker.waitFor({ timeout: 5000 }).catch(() => {});
            const selected = picker.locator('[aria-selected="true"]');
            await selected.waitFor({ timeout: 5000 }).catch(() => {});
            check(
                label('picker opens on the current chapter'),
                (await selected.count()) === 1 &&
                    (await selected.textContent()) === 'Ch. 2.5 - Extra' &&
                    (await selected.isVisible()),
                {
                    selected: await selected.allTextContents().catch(() => null),
                    visible: await selected
                        .first()
                        .isVisible()
                        .catch(() => null),
                },
            );
            const listbox = picker.getByRole('listbox');
            const option100 = picker.getByRole('option', { name: 'Ch. 100', exact: true });
            for (let step = 0; step < 40; step += 1) {
                // oxlint-disable-next-line no-await-in-loop
                if (await option100.isVisible().catch(() => false)) {
                    break;
                }
                // oxlint-disable-next-line no-await-in-loop
                await listbox.evaluate((element) => element.scrollBy(0, 500));
                // oxlint-disable-next-line no-await-in-loop
                await page.waitForTimeout(100);
            }
            await option100.click();
            await waitText(live, 'Chapter hundred talk');
            check(
                label('picking chapter 100 closes the picker and loads its thread'),
                (await picker.count()) === 0 &&
                    (await chooser.textContent()) === 'Ch. 100' &&
                    (await isShown(live, 'Chapter hundred talk')),
                { label: await chooser.textContent() },
            );

            await chooser.click();
            await picker.waitFor({ timeout: 5000 }).catch(() => {});
            await picker
                .locator('[aria-selected="true"]')
                .waitFor({ timeout: 5000 })
                .catch(() => {});
            await page.waitForTimeout(300);
            const listBox = await listbox.boundingBox();
            const selectedBox = await picker.locator('[aria-selected="true"]').boundingBox();
            check(
                label('picker reopens scrolled to chapter 100'),
                !!listBox &&
                    !!selectedBox &&
                    selectedBox.y >= listBox.y &&
                    selectedBox.y + selectedBox.height <= listBox.y + listBox.height,
                { listBox, selectedBox },
            );
            await page.keyboard.press('Escape');
            await picker.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            check(
                label('Escape closes the picker, the panel stays'),
                (await picker.count()) === 0 && (await live.isVisible()),
                {},
            );

            const fetchedThreads = Object.keys(relay.counts)
                .filter((path) => path.startsWith('/comment/'))
                .sort();
            check(
                label('only the chapters selected were fetched (no prefetch past the selection)'),
                JSON.stringify(fetchedThreads) ===
                    JSON.stringify([
                        '/comment/chapter/c1-top',
                        '/comment/chapter/c100',
                        '/comment/chapter/c2',
                        '/comment/chapter/c3',
                    ]),
                fetchedThreads,
            );

            await live.getByRole('button', { name: 'Close' }).click();
            await live.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            await openPill(page);
            check(
                label('reopening resets to the entry chapter (Ch. 1)'),
                (await selectorOf(panelOf(page)).chooser.textContent()) === 'Ch. 1',
                {},
            );
            await panelOf(page).getByRole('button', { name: 'Close' }).click();
            await panelOf(page)
                .waitFor({ state: 'hidden', timeout: 5000 })
                .catch(() => {});

            // Per-chapter button on the chapter list (newest first, so chapter 150 is on top).
            const row = chapterRow(page, `Chapter ${LAST_CHAPTER}`);
            await row.waitFor({ timeout: 10_000 }).catch(() => {});
            rowHeightWithButton = (await row.boundingBox())?.height ?? null;
            await row.getByRole('button', { name: 'Comments for this chapter' }).click();
            await waitText(panelOf(page), 'Last chapter talk');
            const rowSelector = selectorOf(panelOf(page));
            check(
                label('row icon opens the panel on that chapter'),
                (await rowSelector.chooser.textContent()) === `Ch. ${LAST_CHAPTER}` &&
                    (await isShown(panelOf(page), 'Last chapter talk')) &&
                    (await rowSelector.next.isDisabled()) &&
                    page.url().endsWith(`/manga/${MANGA_ID}`),
                { url: page.url() },
            );
            await panelOf(page).getByRole('button', { name: 'Close' }).click();
            await panelOf(page)
                .waitFor({ state: 'hidden', timeout: 5000 })
                .catch(() => {});
            await row.getByText(`Chapter ${LAST_CHAPTER}`, { exact: true }).click();
            await page.waitForURL(/\/chapter\//, { timeout: 10_000 }).catch(() => {});
            check(label('tapping the row itself still opens the reader'), /\/chapter\/\d+/.test(page.url()), {
                url: page.url(),
            });
        }

        // 2. Reader: the current chapter's thread; the chapter map comes from the 24 h cache.
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}/chapter/2`);
        const readerButton = page.getByRole('button', { name: 'Comments', exact: true });
        // Open the reader menu: a tap in the middle (above the page's own Retry), once the tap-zone preview is gone.
        for (let attempt = 0; attempt < 4; attempt += 1) {
            // oxlint-disable-next-line no-await-in-loop
            if (await readerButton.isVisible()) {
                break;
            }
            // oxlint-disable-next-line no-await-in-loop
            await page.waitForTimeout(1500);
            // oxlint-disable-next-line no-await-in-loop
            await page.mouse.click(640, 200);
            // oxlint-disable-next-line no-await-in-loop
            await readerButton.waitFor({ timeout: 1500 }).catch(() => {});
        }
        await readerButton.click().catch(() => {});
        await panelOf(page)
            .getByText('Chapter two talk')
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        check(
            label('reader: Comments shows the current chapter'),
            await panelOf(page)
                .getByText('Chapter two talk')
                .isVisible()
                .catch(() => false),
            relay.counts,
        );
        {
            const live = panelOf(page);
            const { chooser, next } = selectorOf(live);
            await next.click().catch(() => {});
            await waitText(live, 'Comick has no thread for chapter 2.5');
            check(label('reader: next steps to 2.5'), (await chooser.textContent()) === 'Ch. 2.5 - Extra', {
                label: await chooser.textContent().catch(() => null),
            });
            await live.getByRole('button', { name: 'Close' }).click();
            await live.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
            await readerButton.click().catch(() => {});
            await waitText(panelOf(page), 'Chapter two talk');
            check(
                label('reader: reopening is back on the current chapter'),
                (await selectorOf(panelOf(page)).chooser.textContent()) === 'Ch. 2 - The Devil Seeker',
                {},
            );
        }
        check(
            label('reader: match and chapter map not refetched'),
            relay.counts['/v1.0/search'] === 1 && relay.counts['/comic/ctest/chapters'] === 1,
            relay.counts,
        );

        // 3. Master switch off: no pill.
        server.meta.set('tsuji_comments', 'false');
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
        await page.getByRole('heading', { name: 'Similar' }).waitFor({ timeout: 20_000 });
        await page.waitForTimeout(500);
        const rowOff = chapterRow(page, `Chapter ${LAST_CHAPTER}`);
        await rowOff.waitFor({ timeout: 10_000 }).catch(() => {});
        const rowHeightWithout = (await rowOff.boundingBox())?.height ?? null;
        check(
            label('row icon hidden while comments are off, row height unchanged by it'),
            (await rowOff.getByRole('button', { name: 'Comments for this chapter' }).count()) === 0 &&
                rowHeightWithButton !== null &&
                rowHeightWithButton === rowHeightWithout,
            { rowHeightWithButton, rowHeightWithout },
        );
        check(
            label('tsuji_comments=false hides the pill'),
            (await page.getByRole('button', { name: 'Comments', exact: true }).count()) === 0,
            {},
        );

        check(label('desktop: no page errors'), pageErrors.length === 0, pageErrors);
        check(label('desktop: no comments console noise'), consoleNoise.length === 0, consoleNoise);
        await context.close();
    }

    // 4. No match: search by another title, pick, merged into tsuji_commentsMatch.
    {
        const server = createServer('Unknown Series', { tsuji_commentsMatch: JSON.stringify({ 5: 'keep|5' }) });
        const relay = createRelay();
        const { context, page, pageErrors } = await openContext(browser, {
            server,
            relay,
            contextOptions: { viewport: { width: 1280, height: 900 } },
        });
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
        const panel = await openPill(page);
        await panel
            .getByText('No Comick thread for this series')
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        check(
            label('no match: one line plus a search field'),
            (await panel.getByText('No Comick thread for this series').isVisible()) &&
                (await panel.getByLabel('Search Comick').inputValue()) === 'Unknown Series',
            {},
        );
        await panel.getByLabel('Search Comick').fill('Other Name');
        await panel.getByRole('button', { name: 'Search', exact: true }).click();
        await panel.getByRole('button', { name: /Other Name/ }).click({ timeout: 10_000 });
        await panel
            .getByText('Other series talk')
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        let stored = null;
        try {
            stored = JSON.parse(server.meta.get('tsuji_commentsMatch'));
        } catch {
            stored = server.meta.get('tsuji_commentsMatch');
        }
        check(
            label('pick stored as "hid|id", merged with what was there'),
            JSON.stringify(stored) === JSON.stringify({ 5: 'keep|5', 9: 'other|88' }),
            stored,
        );
        const text = await panel.innerText();
        check(
            label('picked series loads its chapter 1 thread'),
            text.includes('Other series talk') && text.includes('Comick, matched by hand'),
            {},
        );

        await page.reload();
        await openPill(page);
        await panelOf(page)
            .getByText('Other series talk')
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        check(
            label('manual match survives a reload (server meta)'),
            await panelOf(page).getByText('Other series talk').isVisible(),
            {},
        );
        // Twins on the series page: labelled from tsuji_readScanlator (r3392) when it is set.
        server.mangaMeta.set('tsuji_readScanlator', JSON.stringify('B'));
        await page.reload();
        await openPill(page);
        await selectorOf(panelOf(page)).next.click();
        check(
            label('series page: twin labelled from tsuji_readScanlator'),
            (await selectorOf(panelOf(page)).chooser.textContent()) === 'Ch. 2 - Devil Seeker (B)',
            { label: await selectorOf(panelOf(page)).chooser.textContent() },
        );
        check(label('no match: no page errors'), pageErrors.length === 0, pageErrors);
        await context.close();
    }

    // 5. Relay down (refused, then hanging past 5 s), then back: one line with Retry, one request each time.
    {
        const server = createServer('Comments Test');
        const relay = createRelay();
        let mode = 'down';
        const { context, page, pageErrors, consoleNoise } = await openContext(browser, {
            server,
            relay,
            relayMode: () => mode,
            contextOptions: { viewport: { width: 1280, height: 900 } },
        });
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
        const panel = await openPill(page);
        const unreachable = panel.getByText('Comments relay unreachable');
        await unreachable.waitFor({ timeout: 10_000 }).catch(() => {});
        await page.waitForTimeout(1000);
        check(
            label('refused: "Comments relay unreachable" + Retry after one request'),
            (await unreachable.isVisible()) &&
                (await panel.getByRole('button', { name: 'Retry' }).isVisible()) &&
                relay.counts.refused === 1,
            relay.counts,
        );

        mode = 'hang';
        const startedAt = Date.now();
        await panel.getByRole('button', { name: 'Retry' }).click();
        // Loading first (the line goes away), then the line again once the 5 s timeout fires.
        await unreachable.waitFor({ state: 'hidden', timeout: 2000 }).catch(() => {});
        await unreachable.waitFor({ timeout: 12_000 }).catch(() => {});
        const waited = Date.now() - startedAt;
        check(
            label('hanging relay: gives up after the 5 s timeout'),
            (await unreachable.isVisible()) && waited >= 4500 && waited < 8000 && relay.counts.hung === 1,
            { waited, counts: relay.counts },
        );

        mode = 'up';
        await panel.getByRole('button', { name: 'Retry' }).click();
        await panel
            .getByText('First')
            .first()
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        check(
            label('Retry once the relay is back loads the thread'),
            await panel.getByText('First').first().isVisible(),
            {},
        );
        check(label('relay down: no page errors'), pageErrors.length === 0, pageErrors);
        check(label('relay down: no comments console noise'), consoleNoise.length === 0, consoleNoise);
        await context.close();
    }

    // 6. Phone: bottom sheet.
    {
        const server = createServer('Comments Test');
        const relay = createRelay();
        const { context, page } = await openContext(browser, {
            server,
            relay,
            contextOptions: {
                viewport: { width: 390, height: 844 },
                hasTouch: true,
                isMobile: browserName === 'chrome',
            },
        });
        await page.goto(`${ORIGIN}/manga/${MANGA_ID}`);
        const panel = await openPill(page);
        await page.waitForTimeout(500);
        await panel
            .getByText('First')
            .first()
            .waitFor({ timeout: 10_000 })
            .catch(() => {});
        if (SCREENSHOT_DIR) {
            await page.screenshot({ path: join(SCREENSHOT_DIR, `comments-phone-${browserName}.png`) });
        }
        const box = await panel.boundingBox();
        check(
            label('phone: bottom sheet, full width, about 85 % high'),
            box && box.width === 390 && Math.abs(box.y + box.height - 844) < 2 && Math.abs(box.height - 844 * 0.85) < 4,
            box,
        );
        const { chooser, previous, next } = selectorOf(panel);
        const arrowBoxes = [await previous.boundingBox(), await next.boundingBox()];
        check(
            label('phone: selector arrows have 40 px targets'),
            arrowBoxes.every((arrow) => arrow && arrow.width >= 40 && arrow.height >= 40),
            arrowBoxes,
        );
        await chooser.click();
        const picker = page.getByRole('dialog', { name: 'Choose chapter' });
        await picker.waitFor({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(500);
        const pickerBox = await picker.boundingBox();
        check(
            label('phone: the picker is a bottom sheet'),
            !!pickerBox && pickerBox.width === 390 && Math.abs(pickerBox.y + pickerBox.height - 844) < 2,
            pickerBox,
        );
        if (SCREENSHOT_DIR) {
            await page.screenshot({ path: join(SCREENSHOT_DIR, `comments-picker-phone-${browserName}.png`) });
        }
        await page.keyboard.press('Escape');
        await panel.getByRole('button', { name: 'Close' }).click();
        await panel.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});

        const row = chapterRow(page, `Chapter ${LAST_CHAPTER}`);
        await row.scrollIntoViewIfNeeded().catch(() => {});
        const rowBox = await row.boundingBox();
        const iconBox = await row.getByRole('button', { name: 'Comments for this chapter' }).boundingBox();
        check(
            label('phone: row icon fits inside the row (40 px target, no overflow)'),
            !!rowBox &&
                !!iconBox &&
                iconBox.width >= 40 &&
                iconBox.x >= rowBox.x &&
                iconBox.x + iconBox.width <= rowBox.x + rowBox.width &&
                rowBox.x + rowBox.width <= 390,
            { rowBox, iconBox },
        );
        if (SCREENSHOT_DIR) {
            await page.screenshot({ path: join(SCREENSHOT_DIR, `comments-rows-phone-${browserName}.png`) });
        }
        await context.close();
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
