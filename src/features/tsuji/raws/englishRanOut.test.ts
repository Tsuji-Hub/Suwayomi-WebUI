/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import {
    formatElapsed,
    getMissingNumbers,
    getReaderAlignLine,
    getReaderPath,
    getSeriesAlignLine,
    getShortSource,
    parseMtlStatus,
} from '@/features/tsuji/raws/mtlStatus.ts';
import { cutAtForeign, mergeInlineMtl } from '@/features/tsuji/raws/crossSeries.ts';
import { fetchMtlStatus, getMtlEntry, getMtlKey, requestMtl, resetMtlEngine } from '@/features/tsuji/raws/mtlEngine.ts';

const chapter = (id: number, chapterNumber: number) => ({ id, chapterNumber });
const at = (chapterNumber: number, id = chapterNumber) => ({ id, chapterNumber });

// The live meta of The Game That I Came From (MangaFire 3526), 2026-10-25.
const META = JSON.stringify([
    {
        kind: 'raw',
        mangaId: 14662,
        title: '我来自游戏',
        source: '如漫画',
        numbering: '…',
        req: '45a2bd8d6431cb55427d0724',
        api: 'http://192.168.5.85:4568/mtl/',
    },
    { kind: 'mtl', mangaId: 16353 },
    {
        kind: 'align',
        en: 224.0,
        en_source: 'Asura Scans (EN)',
        raw: 224.0,
        score: 0.889,
        last_raw: 0.95,
        verdict: '= raw 224, both end at the same panel; next raw = 225',
        ok: true,
        next_raw: 225.0,
        at: 1792896300,
        boiler_skipped: 4,
    },
]);

describe('tsuji_raw_links (brief #19)', () => {
    it('reads the engine, the signature and the art match', () => {
        const links = parseRawLinks(META);
        expect(links.raw).toMatchObject({
            mangaId: 14662,
            api: 'http://192.168.5.85:4568/mtl',
            req: '45a2bd8d6431cb55427d0724',
        });
        expect(links.mtl).toEqual({ kind: 'mtl', mangaId: 16353 });
        expect(links.align).toMatchObject({
            en: 224,
            raw: 224,
            isOk: true,
            nextRaw: 225,
            enSource: 'Asura Scans (EN)',
        });
    });

    it('never takes a non-http engine address', () => {
        const links = parseRawLinks(JSON.stringify([{ kind: 'raw', mangaId: 1, api: 'file:///etc/passwd', req: 'x' }]));
        expect(links.raw?.api).toBe('');
    });
});

describe('alignment lines', () => {
    const { align } = parseRawLinks(META);

    it('reader: confirms the raw chapter that follows, else the verdict, else nothing', () => {
        expect(getReaderAlignLine(align, 225)).toEqual({ kind: 'follows', raw: 225, en: 224, source: 'Asura' });
        expect(getReaderAlignLine(align, 227)).toEqual({ kind: 'warning', verdict: align!.verdict });
        expect(getReaderAlignLine({ ...align!, isOk: false }, 225)).toEqual({
            kind: 'warning',
            verdict: align!.verdict,
        });
        expect(getReaderAlignLine(null, 225)).toBeNull();
    });

    it('series: a match, an incomplete raw with how far it gets, or the verdict', () => {
        expect(getSeriesAlignLine(align)).toEqual({ kind: 'match', en: 224, raw: 224, source: 'Asura' });
        expect(
            getSeriesAlignLine({ ...align!, isOk: false, verdict: 'INCOMPLETE: raw stops early', lastRaw: 0.28 }),
        ).toEqual({
            kind: 'incomplete',
            percent: 28,
        });
        expect(getSeriesAlignLine({ ...align!, isOk: false, verdict: 'no match' })).toEqual({
            kind: 'warning',
            verdict: 'no match',
        });
        expect(getSeriesAlignLine(null)).toBeNull();
    });

    it('short source names', () => {
        expect(getShortSource('Asura Scans (EN)')).toBe('Asura');
        expect(getShortSource('MangaFire')).toBe('MangaFire');
    });
});

describe('engine answers', () => {
    it('parses each state and keeps only the reader path of the url', () => {
        expect(parseMtlStatus({ state: 'none' })).toEqual({ state: 'none' });
        expect(parseMtlStatus({ state: 'queued', position: 1 })).toEqual({ state: 'queued', position: 1 });
        expect(
            parseMtlStatus({
                state: 'running',
                stage: 'translate 1/2',
                pages_ready: 10,
                pages_total: 191,
                elapsed: 95,
                url: 'http://192.168.5.85:4567/manga/16353/chapter/1',
            }),
        ).toEqual({
            state: 'running',
            stage: 'translate 1/2',
            pagesReady: 10,
            pagesTotal: 191,
            elapsed: 95,
            path: '/manga/16353/chapter/1',
        });
        expect(
            parseMtlStatus({
                state: 'partial',
                pages_ready: 10,
                pages_total: 191,
                url: 'http://x/manga/16353/chapter/1',
            }),
        ).toEqual({
            state: 'partial',
            pagesReady: 10,
            pagesTotal: 191,
            path: '/manga/16353/chapter/1',
        });
        expect(parseMtlStatus({ state: 'ready', url: 'http://x/manga/16353/chapter/2' })).toEqual({
            state: 'ready',
            path: '/manga/16353/chapter/2',
        });
        expect(parseMtlStatus('nonsense')).toEqual({ state: 'none' });
        expect(getReaderPath('http://evil/other')).toBeNull();
        expect(formatElapsed(95)).toBe('1:35');
    });

    it('missing numbers between two chapters', () => {
        expect(getMissingNumbers(224, 226)).toEqual([225]);
        expect(getMissingNumbers(226, 224)).toEqual([225]);
        expect(getMissingNumbers(10, 14)).toEqual([11, 12, 13]);
        expect(getMissingNumbers(-1, 5)).toEqual([]);
    });
});

describe('Next / Previous across English and MTL', () => {
    // Newest first, as the reader keeps them: English 226, 224, 223 (no 225 in the filter).
    const english = [chapter(3, 226), chapter(2, 224), chapter(1, 223)];
    const mtl225 = { number: 225, path: '/manga/16353/chapter/1' };

    it('English 224: the list ends there, Next is MTL 225', () => {
        const cut = cutAtForeign(english[1], english, [mtl225], false);
        expect(cut.next).toEqual(mtl225);
        expect(cut.previous).toBeNull();
        expect(cut.chapters.map(({ id }) => id)).toEqual([2, 1]);
    });

    it('English 226: Previous is MTL 225; 223 is untouched', () => {
        const at226 = cutAtForeign(english[0], english, [mtl225], false);
        expect(at226.previous).toEqual(mtl225);
        expect(at226.chapters.map(({ id }) => id)).toEqual([3]);
        expect(cutAtForeign(english[2], english, [mtl225], false)).toEqual({
            chapters: english,
            next: null,
            previous: null,
        });
    });

    it('MTL 225: English wins a tie both ways (226 next, 224 back)', () => {
        const mtl = [chapter(13, 226), chapter(12, 225), chapter(11, 224)];
        const foreign = [
            { number: 224, path: '/manga/3526/chapter/224' },
            { number: 226, path: '/manga/3526/chapter/226' },
        ];
        const cut = cutAtForeign(mtl[1], mtl, foreign, true);
        expect(cut.next?.number).toBe(226);
        expect(cut.previous?.number).toBe(224);
        expect(cut.chapters.map(({ id }) => id)).toEqual([12]);
    });

    it('MTL 226 without English 227: its own next MTL chapter stays', () => {
        const mtl = [chapter(14, 227), chapter(13, 226)];
        const cut = cutAtForeign(mtl[1], mtl, [{ number: 224, path: '/x' }], true);
        expect(cut.next).toBeNull();
        expect(cut.chapters.map(({ id }) => id)).toEqual([14, 13]);
    });
});

describe('the engine client', () => {
    const ref = { api: 'http://relay:4568/mtl', rawId: 14662, number: 225, req: 'sig' };
    const fetchMock = vi.fn();

    beforeEach(() => {
        resetMtlEngine();
        fetchMock.mockReset();
        vi.stubGlobal('fetch', fetchMock);
    });
    afterEach(() => vi.unstubAllGlobals());

    const answer = (status: number, body: unknown) =>
        fetchMock.mockResolvedValueOnce({ status, json: () => Promise.resolve(body) });

    it('asks only the engine from the meta, with the raw, the number and the signature', async () => {
        answer(200, { state: 'none' });
        await fetchMtlStatus(ref);
        answer(200, { ok: true, state: 'queued', position: 1 });
        await requestMtl(ref);
        expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
            'http://relay:4568/mtl/s?raw=14662&ch=225',
            'http://relay:4568/mtl/req?raw=14662&ch=225&sig=sig',
        ]);
        expect(getMtlEntry(getMtlKey(ref))).toMatchObject({
            status: { state: 'queued', position: 1 },
            isRequested: true,
        });
    });

    it('a bad signature is final: no second request', async () => {
        answer(403, { ok: false });
        await requestMtl(ref);
        await requestMtl(ref);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(getMtlEntry(getMtlKey(ref)).error).toBe('refused');
    });

    it('an engine that does not answer is "unreachable"', async () => {
        fetchMock.mockRejectedValueOnce(new Error('network'));
        await fetchMtlStatus(ref);
        expect(getMtlEntry(getMtlKey(ref)).error).toBe('unreachable');
    });
});

describe('inline MTL rows', () => {
    it('fill the numbers English lacks, in the list order, never a number English has', () => {
        const english = [at(226), at(224), at(223)];
        const mtl = [at(225, 1225), at(224, 1224), at(227, 1227)];
        expect(mergeInlineMtl(english, mtl, new Set([223, 224, 226]), true).map(({ id }) => id)).toEqual([
            1227, 226, 1225, 224, 223,
        ]);
        expect(mergeInlineMtl([...english].reverse(), mtl, new Set([223, 224, 226]), true).map(({ id }) => id)).toEqual(
            [223, 224, 1225, 226, 1227],
        );
    });

    it('English for 225 in the filter: no MTL row', () => {
        const english = [at(226), at(225), at(224)];
        expect(mergeInlineMtl(english, [at(225, 1225)], new Set([224, 225, 226]), true)).toBe(english);
    });
});
