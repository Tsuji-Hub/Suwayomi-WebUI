/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import { getChapterFraction, getEndOffer, getPaneScrollTop } from '@/features/tsuji/raws/compareSync.ts';
import { getMangaIdFromUrl, getSeriesLinks, parseRawFeed, parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import { buildRawChapterMap, parseRawChapterNumber } from '@/features/tsuji/raws/rawNumbering.ts';

const FEED_ROW = {
    title: 'Return to Player',
    en_id: 12210,
    en_max: '138',
    raw_id: 13858,
    raw_max: '249',
    ahead: 110,
    source: 'GoodToon',
    origin: 'KR',
    uncensored: false,
    cover: 'http://x/api/v1/manga/12210/thumbnail',
    en_url: 'http://x/manga/12210',
    raw_url: 'http://x/manga/13858',
    mtl_url: 'http://x/manga/14377',
    done: 2,
    next: '141',
    queued: 0,
    t_next: 'http://192.168.5.85:4568/mtl/t?raw=13858&ch=141&n=1&sig=a',
    t_10: 'http://192.168.5.85:4568/mtl/t?raw=13858&ch=141&n=10&sig=b',
    t_all: 'http://192.168.5.85:4568/mtl/t?raw=13858&ch=141&n=108&sig=c',
    n_all: 108,
    cancel: '',
};

describe('tsuji_raw_links', () => {
    it('reads the raw and the mtl entry', () => {
        expect(
            parseRawLinks(
                JSON.stringify([
                    { kind: 'raw', mangaId: 13858, title: '나 혼자', source: 'GoodToon', numbering: 'x' },
                    { kind: 'mtl', mangaId: 14377 },
                ]),
            ),
        ).toEqual({
            raw: { kind: 'raw', mangaId: 13858, title: '나 혼자', source: 'GoodToon' },
            mtl: { kind: 'mtl', mangaId: 14377 },
        });
    });

    it('treats anything malformed as no link', () => {
        expect(parseRawLinks(undefined)).toEqual({ raw: null, mtl: null });
        expect(parseRawLinks('not json')).toEqual({ raw: null, mtl: null });
        expect(parseRawLinks('{"kind":"raw"}')).toEqual({ raw: null, mtl: null });
        expect(parseRawLinks('[{"kind":"raw","mangaId":"x"},{"kind":"mtl","mangaId":0}]')).toEqual({
            raw: null,
            mtl: null,
        });
    });
});

describe('raws.json', () => {
    it('keys rows by en_id and keeps the pre-signed links as they are', () => {
        const rows = parseRawFeed({ at: 'now', linked: 1, rows: [FEED_ROW, { title: 'no id' }] });
        expect([...rows.keys()]).toEqual([12210]);
        expect(rows.get(12210)).toMatchObject({
            ahead: 110,
            next: '141',
            origin: 'KR',
            tAll: FEED_ROW.t_all,
            nAll: 108,
            queued: 0,
            uncensored: false,
        });
        expect(parseRawFeed(null).size).toBe(0);
        expect(parseRawFeed({ rows: 'x' }).size).toBe(0);
    });

    it('finds manga ids in server URLs and combines meta with the feed', () => {
        expect(getMangaIdFromUrl('http://x/manga/14377')).toBe(14377);
        expect(getMangaIdFromUrl('http://x/manga/14377/chapter/2')).toBe(14377);
        expect(getMangaIdFromUrl('')).toBeNull();
        const row = parseRawFeed({ rows: [FEED_ROW] }).get(12210);
        expect(getSeriesLinks({ raw: null, mtl: null }, row)).toEqual({
            rawId: 13858,
            rawSource: 'GoodToon',
            mtlId: 14377,
            isUncensored: false,
            hasAny: true,
        });
        expect(getSeriesLinks({ raw: null, mtl: null }, undefined).hasAny).toBe(false);
    });
});

const chapter = (name: string, chapterNumber = -1, sourceOrder = 1) => ({ name, chapterNumber, sourceOrder });

describe('raw chapter numbering', () => {
    it('KR: the FIRST N화', () => {
        expect(parseRawChapterNumber(chapter('귀환자의 마법은 특별해야 합니다 138화 (2부 12화)'), 'KR')).toBe(138);
        expect(parseRawChapterNumber(chapter('１３９화'), 'KR')).toBe(139);
    });

    it('CN: the LAST 第N话', () => {
        expect(parseRawChapterNumber(chapter('第2季 第3话 重生 第45话'), 'CN')).toBe(45);
        expect(parseRawChapterNumber(chapter('第12.5话 番外'), 'CN')).toBe(12.5);
    });

    it('JP: 第N話 or N話', () => {
        expect(parseRawChapterNumber(chapter('第7話 帰還'), 'JP')).toBe(7);
        expect(parseRawChapterNumber(chapter('12話'), 'JP')).toBe(12);
    });

    it('falls back to chapterNumber; unnumbered extras and paywalled previews never map', () => {
        expect(parseRawChapterNumber(chapter('Episode', 41), 'KR')).toBe(41);
        expect(parseRawChapterNumber(chapter('후기'), 'KR')).toBeNull();
        expect(parseRawChapterNumber(chapter('🔒 140화', 140), 'KR')).toBeNull();
    });

    it('maps numbers to chapters, first by source order on duplicates', () => {
        const map = buildRawChapterMap(
            [
                chapter('138화', -1, 5),
                chapter('138화 재업', -1, 3),
                chapter('🔒 139화', 139, 6),
                chapter('공지', -1, 7),
            ],
            'KR',
        );
        expect([...map.keys()]).toEqual([138]);
        expect(map.get(138)?.sourceOrder).toBe(3);
    });
});

describe('compare sync', () => {
    it('maps the English scroll fraction to the raw pane', () => {
        expect(
            getChapterFraction({ scrollTop: 1000, viewportHeight: 1000, chapterTop: 1000, chapterBottom: 11000 }),
        ).toBe(0);
        expect(
            getChapterFraction({ scrollTop: 5500, viewportHeight: 1000, chapterTop: 1000, chapterBottom: 11000 }),
        ).toBe(0.5);
        expect(
            getChapterFraction({ scrollTop: 20000, viewportHeight: 1000, chapterTop: 1000, chapterBottom: 11000 }),
        ).toBe(1);
        expect(getChapterFraction({ scrollTop: 0, viewportHeight: 1000, chapterTop: 1000, chapterBottom: 1500 })).toBe(
            0,
        );
        expect(getPaneScrollTop(0.5, 21000, 1000)).toBe(10000);
        expect(getPaneScrollTop(2, 21000, 1000)).toBe(20000);
    });
});

describe('end of the English release', () => {
    const row = { ahead: 110, next: '141', tNext: 'http://relay/mtl/t?sig=a' };
    const base = { isNewestChapter: true, fraction: 0.95, chapterNumber: 138, mtlNumbers: new Set<number>(), row };

    it('offers the MTL chapter when it exists, else translating the next raw chapter', () => {
        expect(getEndOffer({ ...base, mtlNumbers: new Set([139, 140]) })).toEqual({ kind: 'read', number: 139 });
        expect(getEndOffer(base)).toEqual({ kind: 'translate', number: '141', url: row.tNext });
    });

    it('offers nothing before the end, on older chapters, or when the raw is not ahead', () => {
        expect(getEndOffer({ ...base, fraction: 0.5 })).toBeNull();
        expect(getEndOffer({ ...base, isNewestChapter: false })).toBeNull();
        expect(getEndOffer({ ...base, row: { ...row, ahead: 0 } })).toBeNull();
        expect(getEndOffer({ ...base, row: undefined })).toBeNull();
    });
});
