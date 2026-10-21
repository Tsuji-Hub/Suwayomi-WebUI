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
    pickBellSeries,
    planBellWrite,
    readBellWatermarks,
    resolveWatchedCategories,
    toSeconds,
    withTitleCount,
} from '@/features/tsuji/bell/chapterBell.ts';

const READING = { id: 1, name: 'Reading' };
const ONGOING = { id: 2, name: 'ongoing' };
const COMPLETED = { id: 3, name: 'Completed' };

const DAY = 24 * 60 * 60;
/** "Now" for the fixtures, in seconds. */
const NOW = 1_800_000_000;

const manga = (id: number, overrides: Partial<BellManga> = {}): BellManga => ({
    id,
    title: `Series ${id}`,
    thumbnailUrl: null,
    category: 'ongoing',
    inLibrary: true,
    inLibraryAt: NOW - 400 * DAY,
    unreadCount: 1,
    lastReadAt: NOW - 100 * DAY,
    latestFetchedAt: NOW,
    ...overrides,
});

let nextId = 1;
const chapter = (
    mangaId: number,
    chapterNumber: number,
    fetchedAt: number,
    overrides: Partial<BellChapter> = {},
): BellChapter => ({
    id: nextId++,
    mangaId,
    chapterNumber,
    fetchedAt,
    sourceOrder: Math.round(chapterNumber * 10),
    isRead: false,
    ...overrides,
});

/** Chapters 1..read read (fetched long ago), then the given unread ones. */
const series = (mangaId: number, read: number, unread: [number, number][]) => [
    ...Array.from({ length: read }, (_, index) => chapter(mangaId, index + 1, NOW - 300 * DAY, { isRead: true })),
    ...unread.map(([number, fetchedAt]) => chapter(mangaId, number, fetchedAt)),
];

describe('bell entries', () => {
    it('chapters fetched after the last read arrived; an entry per series, newest arrival first', () => {
        const entries = buildBellEntries(
            [manga(1), manga(2, { category: 'Completed' })],
            [
                ...series(1, 10, [
                    [11, NOW - 2 * DAY],
                    [12, NOW - DAY],
                ]),
                chapter(1, 12, NOW - DAY + 60, { sourceOrder: 121 }),
                ...series(2, 50, [[51, NOW - 3 * DAY]]),
            ],
        );
        expect(entries.map(({ mangaId, numbers, category }) => ({ mangaId, numbers, category }))).toEqual([
            { mangaId: 1, numbers: [11, 12], category: 'ongoing' },
            { mangaId: 2, numbers: [51], category: 'Completed' },
        ]);
        expect(entries[0]).toMatchObject({ firstChapter: { sourceOrder: 110 }, newestFetchedAt: NOW - DAY + 60 });
    });

    it('age does not matter: arrivals 30 and 90 days old still make an entry', () => {
        const entries = buildBellEntries(
            [manga(1, { lastReadAt: NOW - 120 * DAY })],
            series(1, 5, [
                [6, NOW - 90 * DAY],
                [7, NOW - 30 * DAY],
            ]),
        );
        expect(entries.map(({ numbers }) => numbers)).toEqual([[6, 7]]);
    });

    it('up to 2 chapters already waiting are tolerated (Log into the Future: 355 waiting, 356-361 new); 3 is a backlog', () => {
        const arrived = (from: number, to: number): [number, number][] =>
            Array.from({ length: to - from + 1 }, (_, index) => [from + index, NOW - DAY]);
        const waiting = (from: number, to: number): [number, number][] =>
            Array.from({ length: to - from + 1 }, (_, index) => [from + index, NOW - 200 * DAY]);
        const zero = buildBellEntries([manga(1)], series(1, 354, arrived(355, 361)));
        const one = buildBellEntries([manga(2)], series(2, 354, [...waiting(355, 355), ...arrived(356, 361)]));
        const two = buildBellEntries([manga(3)], series(3, 354, [...waiting(355, 356), ...arrived(357, 361)]));
        const three = buildBellEntries([manga(4)], series(4, 354, [...waiting(355, 357), ...arrived(358, 361)]));
        expect(zero).toHaveLength(1);
        expect(one[0].numbers).toEqual([355, 356, 357, 358, 359, 360, 361]);
        expect(two).toHaveLength(1);
        expect(three).toEqual([]);
        expect(buildBellEntries([manga(5)], series(5, 10, waiting(11, 11)))).toEqual([]);
    });

    it('highest read is the highest read NUMBER, not the last by source order', () => {
        // I've Become a True Villainess: chapter 19 last by source order, 100 the highest number read.
        const chapters = [
            ...series(1, 100, [[101, NOW - DAY]]),
            chapter(1, 19, NOW - 300 * DAY, { isRead: true, sourceOrder: 99_999 }),
        ];
        expect(buildBellEntries([manga(1)], chapters).map(({ numbers }) => numbers)).toEqual([[101]]);
    });

    it('boundary = last read, or a day after joining the library if later; ms and s both work', () => {
        const unread: [number, number][] = [[2, NOW - 5 * DAY]];
        // Joined 3 days ago: the chapter fetched 5 days ago was waiting (the import), nothing arrived.
        expect(
            buildBellEntries([manga(1, { inLibraryAt: NOW - 3 * DAY, lastReadAt: 0 })], series(1, 1, unread)),
        ).toEqual([]);
        // Last read 10 days ago (given in ms): the chapter arrived after.
        expect(
            buildBellEntries(
                [manga(2, { lastReadAt: (NOW - 10 * DAY) * 1000, inLibraryAt: (NOW - 400 * DAY) * 1000 })],
                series(2, 1, unread),
            ),
        ).toHaveLength(1);
        expect(toSeconds(1_700_000_000_000)).toBe(1_700_000_000);
        expect(toSeconds(1_700_000_000)).toBe(1_700_000_000);
    });

    it('chapters without a number are ignored; reading the new chapter clears the entry', () => {
        const chapters = series(1, 10, [
            [-1, NOW - DAY],
            [11, NOW - DAY],
        ]);
        expect(buildBellEntries([manga(1)], chapters)[0].numbers).toEqual([11]);
        const read = chapters.map((each) => (each.chapterNumber === 11 ? { ...each, isRead: true } : each));
        expect(buildBellEntries([manga(1)], read)).toEqual([]);
    });

    it('series: in the library with something unread, once each, at most 300 (most recently updated first)', () => {
        const many = Array.from({ length: 320 }, (_, index) => manga(index + 1, { latestFetchedAt: NOW - index }));
        const picked = pickBellSeries([
            ...many,
            manga(1),
            manga(900, { unreadCount: 0 }),
            manga(901, { inLibrary: false }),
            manga(902, { latestFetchedAt: (NOW + 10) * 1000 }),
        ]);
        expect(picked).toHaveLength(300);
        expect(picked[0].id).toBe(902);
        expect(picked.some(({ id }) => id === 900 || id === 901)).toBe(false);
        expect(picked.at(-1)?.id).toBe(299);
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
