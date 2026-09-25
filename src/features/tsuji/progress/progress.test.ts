/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    formatChapterNumber,
    formatSeriesProgress,
    getChaptersLeft,
    getReaderDenominator,
    getReaderProgress,
    getSeriesProgress,
} from '@/features/tsuji/progress/progress.ts';

describe('formatChapterNumber', () => {
    it('trims integral decimals', () => expect(formatChapterNumber(200.0)).toBe('200'));
    it('keeps real decimals', () =>
        expect([formatChapterNumber(20.5), formatChapterNumber(20.25)]).toEqual(['20.5', '20.25']));
    it('rounds float noise', () => expect(formatChapterNumber(0.1 + 0.2)).toBe('0.3'));
});

describe('getSeriesProgress', () => {
    it('uses the highest numbered chapter', () =>
        expect(getSeriesProgress({ latestReadNumber: 21, highestNumber: 200, totalCount: 210 })).toEqual({
            read: 21,
            total: 200,
        }));

    it('falls back to totalCount without chapter numbers', () => {
        expect(getSeriesProgress({ latestReadNumber: 21, highestNumber: -1, totalCount: 150 })).toEqual({
            read: 21,
            total: 150,
        });
        expect(getSeriesProgress({ latestReadNumber: 21, highestNumber: null, totalCount: 150 })).toEqual({
            read: 21,
            total: 150,
        });
    });

    it('hides when nothing is read', () =>
        [null, undefined, 0, -1].forEach((latestReadNumber) =>
            expect(getSeriesProgress({ latestReadNumber, highestNumber: 200, totalCount: 200 })).toBeNull(),
        ));

    it('drops a total below the read number', () =>
        expect(getSeriesProgress({ latestReadNumber: 21, highestNumber: 20, totalCount: 20 })).toEqual({
            read: 21,
            total: null,
        }));
});

describe('formatSeriesProgress', () => {
    it('renders read/total with trimmed decimals', () =>
        expect(formatSeriesProgress({ read: 21.0, total: 200.0 })).toBe('21/200'));
    it('keeps half chapters', () => expect(formatSeriesProgress({ read: 20.5, total: 103 })).toBe('20.5/103'));
    it('renders only the read number without a total', () =>
        expect(formatSeriesProgress({ read: 21, total: null })).toBe('21'));
});

describe('getChaptersLeft', () => {
    it('subtracts', () => expect(getChaptersLeft({ read: 21, total: 200 })).toBe(179));

    it('floors at zero and keeps halves', () => {
        expect(getChaptersLeft({ read: 200, total: 200 })).toBe(0);
        expect(getChaptersLeft({ read: 20.5, total: 21 })).toBe(0.5);
    });

    it('is null without a total', () => expect(getChaptersLeft({ read: 3, total: null })).toBeNull());
});

describe('reader progress', () => {
    it('uses the max known number, ignoring -1', () => expect(getReaderDenominator([1, 2, -1, 200, 3])).toBe(200));
    it('falls back to the list size without numbers', () => expect(getReaderDenominator([-1, -1, -1])).toBe(3));
    it('has no denominator for a single chapter', () => expect(getReaderDenominator([1])).toBeNull());

    it('hides the total unless strictly greater than the current chapter', () => {
        expect(getReaderProgress(21, 200)).toEqual({ current: 21, total: 200 });
        expect(getReaderProgress(200, 200)).toEqual({ current: 200, total: null });
        expect(getReaderProgress(21, null)).toEqual({ current: 21, total: null });
        expect(getReaderProgress(-1, 200)).toBeNull();
        expect(getReaderProgress(undefined, 200)).toBeNull();
    });
});
