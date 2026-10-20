/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    buildCommentChapters,
    findPreviewChapter,
    formatChapterLabel,
    getChapterLabel,
    getChapterStep,
    getLastReadScanlator,
    getPickerIndex,
} from '@/features/tsuji/comments/chapterNav.ts';

const chapter = (chapterNumber: number, sourceOrder: number, scanlator: string | null = null, name?: string) => ({
    chapterNumber,
    sourceOrder,
    scanlator,
    name: name ?? `Chapter ${chapterNumber}`,
});

describe('formatChapterLabel', () => {
    it('drops the number the name repeats and keeps the title', () => {
        expect(formatChapterLabel(75, 'Chapter 75 - The Devil Seeker (2)')).toBe('Ch. 75 - The Devil Seeker (2)');
        expect(formatChapterLabel(75, 'Ch. 75: The Devil Seeker')).toBe('Ch. 75 - The Devil Seeker');
        expect(formatChapterLabel(12.5, 'Chapter 12.5')).toBe('Ch. 12.5');
        expect(formatChapterLabel(3, 'Chapter 003')).toBe('Ch. 3');
        expect(formatChapterLabel(1, 'Prologue')).toBe('Ch. 1 - Prologue');
    });

    it('does not eat a longer number that starts with this one', () => {
        expect(formatChapterLabel(1, 'Chapter 12')).toBe('Ch. 1 - Chapter 12');
        expect(formatChapterLabel(1, 'Chapter 1.5 extra')).toBe('Ch. 1 - Chapter 1.5 extra');
    });
});

describe('buildCommentChapters', () => {
    const chapters = [
        chapter(2, 3, 'B', 'Chapter 2 - from B'),
        chapter(1, 1, 'A', 'Chapter 1 - from A'),
        chapter(1, 2, 'B', 'Chapter 1 - from B'),
        chapter(2, 4, 'A', 'Chapter 2 - from A'),
        chapter(-1, 5, 'A', 'Special'),
        chapter(1.5, 6, 'A', 'Chapter 1.5'),
    ];

    it('one entry per number, ascending, numberless chapters left out', () => {
        expect(buildCommentChapters(chapters).map(({ number }) => number)).toEqual([1, 1.5, 2]);
    });

    it("labels twins from the reference scanlator's copy, else the first by source order", () => {
        expect(buildCommentChapters(chapters, 'B').map(({ label }) => label)).toEqual([
            'Ch. 1 - from B',
            'Ch. 1.5',
            'Ch. 2 - from B',
        ]);
        expect(buildCommentChapters(chapters).map(({ label }) => label)).toEqual([
            'Ch. 1 - from A',
            'Ch. 1.5',
            'Ch. 2 - from B',
        ]);
    });
});

describe('steps and picker position', () => {
    const list = buildCommentChapters([chapter(1, 1), chapter(2, 2), chapter(2.5, 3), chapter(3, 4), chapter(10, 5)]);

    it('steps through numbers and stops at both ends', () => {
        expect(getChapterStep(list, 1, -1)).toBeNull();
        expect(getChapterStep(list, 1, 1)).toBe(2);
        expect(getChapterStep(list, 2, 1)).toBe(2.5);
        expect(getChapterStep(list, 10, 1)).toBeNull();
        expect(getChapterStep(list, 10, -1)).toBe(3);
    });

    it('steps from a number missing from the list to its neighbours', () => {
        expect(getChapterStep(list, 5, -1)).toBe(3);
        expect(getChapterStep(list, 5, 1)).toBe(10);
        expect(getChapterStep([], 5, 1)).toBeNull();
    });

    it('opens the picker on the current entry, else the last one below it', () => {
        expect(getPickerIndex(list, 1)).toBe(0);
        expect(getPickerIndex(list, 3)).toBe(3);
        expect(getPickerIndex(list, 5)).toBe(3);
        expect(getPickerIndex(list, 0)).toBe(0);
        expect(getPickerIndex([], 5)).toBe(0);
    });

    it('labels a number missing from the list by its number', () => {
        expect(getChapterLabel(list, 2.5)).toBe('Ch. 2.5');
        expect(getChapterLabel(list, 7)).toBe('Ch. 7');
    });
});

describe('getLastReadScanlator', () => {
    it('is the scanlator of the most recent read, undefined when nothing was read', () => {
        expect(
            getLastReadScanlator([
                { scanlator: 'A', lastReadAt: '100' },
                { scanlator: 'B', lastReadAt: '300' },
                { scanlator: 'C', lastReadAt: '0' },
            ]),
        ).toBe('B');
        expect(getLastReadScanlator([{ scanlator: null, lastReadAt: '5' }])).toBeNull();
        expect(getLastReadScanlator([{ scanlator: 'A', lastReadAt: '0' }])).toBeUndefined();
    });
});

describe('findPreviewChapter', () => {
    it('the first of chapters 1-5 with comments, else chapter 1; never a later chapter', async () => {
        const asked: number[] = [];
        const withComments = (numbers: number[]) => async (number: number) => {
            asked.push(number);
            return numbers.includes(number);
        };
        const chapters = [0, 1, 2, 2.5, 3, 4, 5, 6, 120];
        expect(await findPreviewChapter(chapters, withComments([2.5, 120]))).toBe(2.5);
        expect(asked).toEqual([1, 2, 2.5]);
        expect(await findPreviewChapter(chapters, withComments([6, 120]))).toBe(1);
        expect(await findPreviewChapter([40, 41], withComments([41]))).toBe(40);
        expect(await findPreviewChapter([], withComments([]))).toBeNull();
    });
});
