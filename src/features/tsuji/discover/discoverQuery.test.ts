/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    buildDiscoverVariables,
    EMPTY_SELECTION,
    getIncludedTags,
    hasSelection,
    matchesOptionalFilters,
} from '@/features/tsuji/discover/discoverQuery.ts';
import { DEFAULT_REC_FILTERS } from '@/features/tsuji/recs/filters.ts';

describe('buildDiscoverVariables', () => {
    it('sends no filters by default (novels/one-shots and adult are filtered client-side)', () =>
        expect(buildDiscoverVariables(EMPTY_SELECTION, DEFAULT_REC_FILTERS)).toEqual({}));

    it('maps tri-state tags and genres to _in / _not_in', () =>
        expect(
            buildDiscoverVariables(
                { genres: { Romance: 'exclude' }, tags: { Revenge: 'include', 'Time Manipulation': 'include' } },
                { ...DEFAULT_REC_FILTERS, hideNovelOneShot: false, showAdult: true },
            ),
        ).toEqual({ genreNotIn: ['Romance'], tagIn: ['Revenge', 'Time Manipulation'] }));

    it('pushes status, score and a single non-Manhua type to AniList', () =>
        expect(
            buildDiscoverVariables(EMPTY_SELECTION, {
                ...DEFAULT_REC_FILTERS,
                statuses: ['RELEASING'],
                minScore: 70,
                types: ['MANHWA'],
            }),
        ).toMatchObject({ statusIn: ['RELEASING'], minScore: 69, country: 'KR' }));

    it('keeps Manhua (CN + TW) and multi-type filtering client-side', () => {
        expect(
            buildDiscoverVariables(EMPTY_SELECTION, { ...DEFAULT_REC_FILTERS, types: ['MANHUA'] }),
        ).not.toHaveProperty('country');
        expect(
            buildDiscoverVariables(EMPTY_SELECTION, { ...DEFAULT_REC_FILTERS, types: ['MANHWA', 'MANGA'] }),
        ).not.toHaveProperty('country');
    });
});

describe('matchesOptionalFilters', () => {
    const media = { status: 'RELEASING', countryOfOrigin: 'KR', averageScore: 80 };

    it('checks status, country and minimum score (strictly greater, like averageScore_greater)', () => {
        expect(matchesOptionalFilters(media, {})).toBe(true);
        expect(matchesOptionalFilters(media, { statusIn: ['RELEASING'], country: 'KR', minScore: 79 })).toBe(true);
        expect(matchesOptionalFilters(media, { statusIn: ['FINISHED'] })).toBe(false);
        expect(matchesOptionalFilters(media, { country: 'JP' })).toBe(false);
        expect(matchesOptionalFilters(media, { minScore: 80 })).toBe(false);
        expect(matchesOptionalFilters({ ...media, averageScore: null }, { minScore: 0 })).toBe(false);
    });
});

describe('selection helpers', () => {
    it('detects a selection and lists included tags', () => {
        const selection = { genres: {}, tags: { Revenge: 'include', Romance: 'exclude' } } as const;

        expect(hasSelection(EMPTY_SELECTION)).toBe(false);
        expect(hasSelection(selection)).toBe(true);
        expect(getIncludedTags(selection)).toEqual(['Revenge']);
    });
});
