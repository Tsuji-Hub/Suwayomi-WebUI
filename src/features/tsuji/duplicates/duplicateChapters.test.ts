/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    getIdsWithReadCopies,
    getResumeChapter,
    getTsujiResumeChapter,
    parseReadScanlator,
    pickCopy,
    tsujiAddDuplicates,
    tsujiRemoveDuplicates,
} from '@/features/tsuji/duplicates/duplicateChapters.ts';

type Chapter = {
    id: number;
    chapterNumber: number;
    scanlator: string | null;
    sourceOrder: number;
    isRead: boolean;
    lastReadAt?: string;
};

/**
 * A manga with two scanlators, source order interleaved like real sources: A and B both have 1-3, only B has 4,
 * only A has 5, 6 is missing, both have 7; two -1 extras.
 */
const MANGA: Chapter[] = [
    [1, 1, 'A'],
    [2, 1, 'B'],
    [3, 2, 'A'],
    [4, 2, 'B'],
    [5, 3, 'B'],
    [6, 3, 'A'],
    [7, 4, 'B'],
    [8, -1, 'A'], // "Extra: side story"
    [9, 5, 'A'],
    [10, -1, 'B'], // "Announcement"
    [11, 7, 'B'],
    [12, 7, 'A'],
].map(([id, chapterNumber, scanlator]) => ({
    id: id as number,
    chapterNumber: chapterNumber as number,
    scanlator: scanlator as string,
    sourceOrder: id as number,
    isRead: false,
}));

const byId = (id: number) => MANGA.find((chapter) => chapter.id === id)!;
const withRead = (ids: number[], chapters = MANGA) =>
    chapters.map((chapter) => ({ ...chapter, isRead: ids.includes(chapter.id) }));
/** The reader's list order: latest first. */
const readerOrder = [...MANGA].sort((a, b) => b.sourceOrder - a.sourceOrder);

describe('sibling marking', () => {
    it('marking a chapter read adds the unread copies of the same number, nothing else', () => {
        expect(getIdsWithReadCopies([3], MANGA)).toEqual([3, 4]);
        expect(getIdsWithReadCopies([11], MANGA)).toEqual([11, 12]);
        expect(getIdsWithReadCopies([7], MANGA)).toEqual([7]); // no copy
    });

    it('never touches another number, a -1 chapter, or an already read copy', () => {
        expect(getIdsWithReadCopies([8], MANGA)).toEqual([8]); // -1: its own chapter
        expect(getIdsWithReadCopies([1, 5], withRead([2]))).toEqual([1, 5, 6]);
    });

    it('reader progress (upstream addDuplicates path): copies of the number only, -1 alone', () => {
        expect(
            tsujiAddDuplicates([byId(5)], MANGA)
                .map(({ id }) => id)
                .sort((a, b) => a - b),
        ).toEqual([5, 6]);
        expect(tsujiAddDuplicates([byId(8)], MANGA).map(({ id }) => id)).toEqual([8]);
        expect(tsujiAddDuplicates([byId(8), byId(10)], MANGA).map(({ id }) => id)).toEqual([8, 10]);
    });

    it('unmarking is not affected: only read marking ever reaches copies', () => {
        // The helper is only called for "mark as read"; mark as unread goes to upstream untouched.
        expect(getIdsWithReadCopies([], MANGA)).toEqual([]);
    });
});

const numbersOf = (chapters: Chapter[]) =>
    chapters.map(({ id, chapterNumber, scanlator }) => `${chapterNumber}${scanlator}#${id}`);

describe('reader next / previous skip', () => {
    it('one copy per number: the current scanlator, else the first by source order; -1 chapters all stay', () => {
        const list = tsujiRemoveDuplicates(byId(1), readerOrder);

        expect(numbersOf(list)).toEqual(['7A#12', '-1B#10', '5A#9', '-1A#8', '4B#7', '3A#6', '2A#3', '1A#1']);
    });

    it('the current chapter itself is kept even if another copy is earlier', () => {
        expect(tsujiRemoveDuplicates(byId(4), readerOrder).map(({ id }) => id)).toContain(4);
        expect(tsujiRemoveDuplicates(byId(4), readerOrder).map(({ id }) => id)).not.toContain(3);
    });

    it('next from 3 on A is 4 on B (A has no 4), then the -1 extra (its own chapter), then 5 on A', () => {
        const list = tsujiRemoveDuplicates(byId(6), readerOrder).reverse(); // reading order
        const index = list.findIndex(({ id }) => id === 6);

        expect(list.slice(index + 1, index + 5).map(({ id }) => id)).toEqual([7, 8, 9, 10]);
    });

    it('a missing number is simply absent (5 -> 7), and 7 picks the current scanlator', () => {
        const fromA = tsujiRemoveDuplicates(byId(9), readerOrder).reverse();
        const fromB = tsujiRemoveDuplicates(byId(7), readerOrder).reverse();

        expect(fromA.slice(-2).map(({ id }) => id)).toEqual([10, 12]);
        expect(fromB.slice(-1).map(({ id }) => id)).toEqual([11]);
    });

    it('no scanlator on the reference: first by source order', () => {
        expect(pickCopy([byId(12), byId(11)], { id: -1, scanlator: 'C' }).id).toBe(11);
        expect(pickCopy([byId(12), byId(11)], null).id).toBe(11);
    });
});

describe('resume choice', () => {
    it('nothing read: the first chapter', () => {
        expect(getResumeChapter(MANGA)?.id).toBe(1);
    });

    it("the first number with no read copy, on the last read chapter's scanlator", () => {
        // Read 1 on A and 2 on B (the copies stayed unread): resume at 3, on B.
        expect(getResumeChapter(withRead([1, 4]))?.id).toBe(5);
        // Read 1-2 on A: resume at 3 on A even though B's 3 comes first by source order.
        expect(getResumeChapter(withRead([1, 3]))?.id).toBe(6);
    });

    it('a read copy counts for the number (upstream would resume at the unread copy)', () => {
        expect(getResumeChapter(withRead([1, 3, 6]))?.id).toBe(7);
    });

    it('-1 chapters count alone, in source order', () => {
        expect(getResumeChapter(withRead([1, 3, 6, 7]))?.id).toBe(8);
        expect(getResumeChapter(withRead([1, 3, 6, 7, 8, 9]))?.id).toBe(10);
    });

    it('scanlator missing for the next number: first by source order', () => {
        // Last read 3 on A; 4 only exists on B.
        expect(getResumeChapter(withRead([1, 3, 6]))?.scanlator).toBe('B');
    });

    it('ties on the furthest number: the most recently read copy decides', () => {
        const readAt: Record<number, string> = { 3: '100', 4: '200' };
        const chapters = withRead([1, 3, 4]).map((chapter) => ({ ...chapter, lastReadAt: readAt[chapter.id] }));
        expect(getResumeChapter(chapters)?.id).toBe(5); // 3 on B
    });

    it('copies marked read together (same time): the scanlator last finished in the reader decides', () => {
        // 1 and 2 read on A, their B copies marked read with them: without the stored scanlator this is a tie.
        const chapters = withRead([1, 2, 3, 4]);
        expect(getResumeChapter(chapters, 'A')?.id).toBe(6);
        expect(getResumeChapter(chapters, 'B')?.id).toBe(5);
        // A stored scanlator without a copy of the next number falls back to the rule.
        expect(getResumeChapter(withRead([1, 2, 3, 4, 5, 6]), 'A')?.id).toBe(7);
        expect(getTsujiResumeChapter(chapters, null, 'A')?.id).toBe(6);
    });

    it('excluded scanlators (chapter list filter): their read copies count, their copies are never picked', () => {
        // B excluded: 4 exists only on B, so Resume skips it (to the -1 extra next); a read B copy counts as read.
        expect(getResumeChapter(withRead([1, 3, 6]), 'A', ['B'])?.id).toBe(8);
        expect(getResumeChapter(withRead([2, 4]), 'B', ['B'])?.id).toBe(6);
    });

    it('stored scanlator value: JSON, null kept apart from unknown', () => {
        expect(parseReadScanlator('"A"')).toBe('A');
        expect(parseReadScanlator('null')).toBeNull();
        expect(parseReadScanlator(undefined)).toBeUndefined();
        expect(parseReadScanlator('{oops')).toBeUndefined();
        expect(parseReadScanlator('5')).toBeUndefined();
    });

    it('everything read: none; list not loaded yet: the server value', () => {
        expect(getResumeChapter(withRead(MANGA.map(({ id }) => id)))).toBeNull();
        expect(getTsujiResumeChapter([], 'server')).toBe('server');
    });
});
