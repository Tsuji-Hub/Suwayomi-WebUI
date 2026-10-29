/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import {
    applyAniListScores,
    getFreshness,
    isComickScored,
    isOngoingStatus,
    sortByMergedScore,
} from '@/features/tsuji/recs/mergedScore.ts';

const card = (id: number, averageScore: number | null, popularity: number | null, extra: Partial<RecMedia> = {}) =>
    ({ id, averageScore, popularity, ...extra }) as RecMedia;

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 9, 26);

describe('merged score (brief #21)', () => {
    it('one list, score descending, ties by popularity, unknown scores last', () => {
        const sorted = sortByMergedScore([
            card(1, 70, 10),
            card(2, null, 99_999),
            card(3, 84, 5),
            card(4, 84, 50),
            card(5, 62, 1),
        ]);
        expect(sorted.map(({ id }) => id)).toEqual([4, 3, 1, 5, 2]);
        const scores = sorted.map(({ averageScore }) => averageScore ?? -1);
        expect(scores.every((score, index) => index === 0 || score <= scores[index - 1])).toBe(true);
    });

    it('keeps the order for equal score and popularity', () =>
        expect(sortByMergedScore([card(1, 80, 1), card(2, 80, 1)]).map(({ id }) => id)).toEqual([1, 2]));

    it("Comick cards with an AniList id take AniList's score and popularity; Comick-only ones keep CK", () => {
        const [scored, comickOnly, aniList] = applyAniListScores(
            [
                card(133_070, 77, 900, { via: 'comick', scoreSource: 'comick' }),
                card(-1_000_000_007, 81, 900, { via: 'comick', scoreSource: 'comick' }),
                card(42, 70, 10),
            ],
            new Map([
                [133_070, { averageScore: 85, meanScore: 86, popularity: 40_000 }],
                [42, { averageScore: 10, meanScore: 10, popularity: 1 }],
            ]),
        );
        expect(scored).toMatchObject({ averageScore: 85, popularity: 40_000, scoreSource: null });
        expect(isComickScored(scored)).toBe(false);
        expect(comickOnly).toMatchObject({ averageScore: 81, scoreSource: 'comick' });
        expect(isComickScored(comickOnly)).toBe(true);
        expect(aniList).toMatchObject({ averageScore: 70 });
        expect(isComickScored(aniList)).toBe(false);
    });

    it('falls back to meanScore when AniList has no averageScore', () =>
        expect(
            applyAniListScores(
                [card(5, 60, 1, { via: 'comick', scoreSource: 'comick' })],
                new Map([[5, { averageScore: null, meanScore: 72, popularity: null }]]),
            )[0],
        ).toMatchObject({ averageScore: 72, popularity: 1 }));

    it("no AniList score at all: the card keeps Comick's, marked CK", () => {
        const [item] = applyAniListScores(
            [card(5, 60, 1, { via: 'comick', scoreSource: 'comick' })],
            new Map([[5, { averageScore: null, meanScore: null, popularity: null }]]),
        );
        expect(item).toMatchObject({ averageScore: 60, scoreSource: 'comick' });
        expect(isComickScored(item)).toBe(true);
    });

    it('freshness: nothing under 6 months, "> 6 MO" from 6, "> 1 YR" from 12', () => {
        expect(getFreshness(null, NOW)).toBeNull();
        expect(getFreshness(NOW - 30 * DAY, NOW)).toBeNull();
        expect(getFreshness(NOW - 100 * DAY, NOW)?.kind).toBe('3mo');
        expect(getFreshness(NOW - 200 * DAY, NOW)?.kind).toBe('6mo');
        expect(getFreshness(NOW - 400 * DAY, NOW)).toEqual({ kind: '1yr', sinceDays: 400, gapDays: null });
    });

    it('v6 release timing: LATE past max(3x the usual gap, 21 days) under 3 months; the relay date as a fallback', () => {
        const timing = (days: number, gapDays: number | null) => ({ lastRelease: NOW - days * DAY, gapDays });
        // Weekly: 3x 7 = 21 days.
        expect(getFreshness(null, NOW, timing(3, 7))).toBeNull();
        expect(getFreshness(null, NOW, timing(20, 7))).toBeNull();
        expect(getFreshness(null, NOW, timing(40, 7))).toEqual({ kind: 'late', sinceDays: 40, gapDays: 7 });
        // Monthly: 3x 30 = 90 days, past 3 months: not late, "> 3 MO" from the relay's date.
        expect(getFreshness(null, NOW, timing(60, 30))).toBeNull();
        expect(getFreshness(null, NOW, timing(120, 30))?.kind).toBe('3mo');
        // No usual gap: no LATE.
        expect(getFreshness(null, NOW, timing(40, null))).toBeNull();
        // Comick's own date first for the month tags.
        expect(getFreshness(NOW - 400 * DAY, NOW, timing(5, 7))?.kind).toBe('1yr');
    });

    it('freshness is for ongoing and hiatus only', () => {
        expect(isOngoingStatus('RELEASING')).toBe(true);
        expect(isOngoingStatus('HIATUS')).toBe(true);
        expect(isOngoingStatus('FINISHED')).toBe(false);
        expect(isOngoingStatus(null)).toBe(false);
    });
});
