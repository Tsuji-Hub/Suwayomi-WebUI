/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { BellChapter, BellManga } from '@/features/tsuji/bell/chapterBell.ts';
import {
    BELL_BUCKET_MAX_CHARS,
    BellBucketFullError,
    buildBellEntries,
    formatBellCount,
    formatChapterRange,
    getFirstRunSeen,
    getRelativeTime,
    isUnseen,
    parseWatchedCategories,
    planBellWrite,
    readBellWatermarks,
    resolveWatchedCategories,
    withTitleCount,
} from '@/features/tsuji/bell/chapterBell.ts';

const READING = { id: 1, name: 'Reading' };
const ONGOING = { id: 2, name: 'ongoing' };
const COMPLETED = { id: 3, name: 'Completed' };

const manga = (id: number, overrides: Partial<BellManga> = {}): BellManga => ({
    id,
    title: `Series ${id}`,
    thumbnailUrl: null,
    unreadCount: 1,
    latestReadNumber: 10,
    categories: [ONGOING],
    ...overrides,
});

let nextId = 1;
const chapter = (mangaId: number, chapterNumber: number, fetchedAt: number, overrides: Partial<BellChapter> = {}) => ({
    id: nextId++,
    mangaId,
    chapterNumber,
    fetchedAt,
    sourceOrder: Math.round(chapterNumber * 10),
    isRead: false,
    ...overrides,
});

const watched = [ONGOING.id, COMPLETED.id];

describe('bell entries', () => {
    it('caught-up series in watched categories with chapters above the highest read, newest fetch first', () => {
        const entries = buildBellEntries({
            mangas: [
                manga(1, { unreadCount: 3 }),
                manga(2, { categories: [COMPLETED], latestReadNumber: 50 }),
                manga(3, { categories: [READING] }),
            ],
            chapters: [
                chapter(1, 11, 100),
                chapter(1, 12, 300),
                chapter(1, 12, 310, { sourceOrder: 121 }),
                chapter(2, 51, 200),
                chapter(3, 11, 400),
            ],
            watchedCategoryIds: watched,
        });
        expect(entries.map(({ mangaId, numbers, category }) => ({ mangaId, numbers, category }))).toEqual([
            { mangaId: 1, numbers: [11, 12], category: 'ongoing' },
            { mangaId: 2, numbers: [51], category: 'Completed' },
        ]);
        expect(entries[0]).toMatchObject({ firstChapter: { sourceOrder: 110 }, newestFetchedAt: 310 });
    });

    it('not caught up: older unread outside the window, nothing read; copies at or below the read number and numberless chapters are ignored', () => {
        const entries = buildBellEntries({
            mangas: [
                manga(1, { unreadCount: 5 }),
                manga(2, { latestReadNumber: null }),
                manga(3, { unreadCount: 3, latestReadNumber: 50 }),
                manga(4, { unreadCount: 1 }),
            ],
            chapters: [
                chapter(1, 11, 100),
                chapter(2, 1, 100),
                chapter(3, 50, 100),
                chapter(3, -1, 100),
                chapter(3, 51, 120),
                chapter(4, 11, 100, { isRead: true }),
            ],
            watchedCategoryIds: watched,
        });
        expect(entries.map(({ mangaId, numbers }) => ({ mangaId, numbers }))).toEqual([{ mangaId: 3, numbers: [51] }]);
    });

    it('watched categories: the saved choice, else the ones named ongoing / Completed', () => {
        expect(resolveWatchedCategories([READING, ONGOING, COMPLETED], null)).toEqual([2, 3]);
        expect(resolveWatchedCategories([READING, ONGOING, COMPLETED], [1])).toEqual([1]);
        expect(parseWatchedCategories('[1, "x", 3]')).toEqual([1, 3]);
        expect(parseWatchedCategories('nope')).toBeNull();
        expect(parseWatchedCategories(undefined)).toBeNull();
    });
});

const entry = (mangaId: number, numbers: number[]) => ({ mangaId, numbers }) as Parameters<typeof isUnseen>[0];

describe('seen watermarks', () => {
    it('unseen until the watermark reaches the highest new number', () => {
        expect(isUnseen(entry(1, [11, 12]), new Map())).toBe(true);
        expect(isUnseen(entry(1, [11, 12]), new Map([[1, 11]]))).toBe(true);
        expect(isUnseen(entry(1, [11, 12]), new Map([[1, 12]]))).toBe(false);
    });

    it('sharded by mangaId % 16, merged into the server value, only rising, untouched buckets left alone', () => {
        const meta = { tsuji_bell_1: '{"1":5,"17":30}', tsuji_bell_2: 'broken' };
        expect([...readBellWatermarks(meta)]).toEqual([
            [1, 5],
            [17, 30],
        ]);
        expect(
            planBellWrite(
                meta,
                new Map([
                    [17, 12],
                    [33, 7],
                    [2, 3],
                ]),
            ),
        ).toEqual([
            ['tsuji_bell_1', '{"1":5,"17":30,"33":7}'],
            ['tsuji_bell_2', '{"2":3}'],
        ]);
        expect(planBellWrite(meta, new Map([[1, 4]]))).toEqual([]);
    });

    it('a bucket over the limit writes nothing', () => {
        const patch = new Map(Array.from({ length: 400 }, (_, index) => [index * 16 + 16, 1234.5]));
        expect(() => planBellWrite({}, patch)).toThrow(BellBucketFullError);
        expect(JSON.stringify(Object.fromEntries(patch)).length).toBeGreaterThan(BELL_BUCKET_MAX_CHARS);
    });

    it('first run: only the newest 30 start unseen', () => {
        const entries = Array.from({ length: 33 }, (_, index) => entry(index + 1, [index + 2]));
        expect([...getFirstRunSeen(entries).keys()]).toEqual([31, 32, 33]);
    });
});

describe('formatting', () => {
    it('ranges, badge, relative time, title prefix', () => {
        expect(formatChapterRange([152])).toBe('152');
        expect(formatChapterRange([152, 153.5, 154])).toBe('152-154');
        expect([formatBellCount(0), formatBellCount(7), formatBellCount(120)]).toEqual(['', '7', '99+']);
        expect(getRelativeTime(1000, 1000 * 1000 + 30 * 60 * 1000)).toEqual({ value: -30, unit: 'minute' });
        expect(getRelativeTime(0, 5 * 3600 * 1000)).toEqual({ value: -5, unit: 'hour' });
        expect(getRelativeTime(0, 3 * 86_400 * 1000)).toEqual({ value: -3, unit: 'day' });
        expect(withTitleCount('Library', 3)).toBe('(3) Library');
        expect(withTitleCount('(3) Library', 120)).toBe('(99+) Library');
        expect(withTitleCount('(99+) Library', 0)).toBe('Library');
    });
});
