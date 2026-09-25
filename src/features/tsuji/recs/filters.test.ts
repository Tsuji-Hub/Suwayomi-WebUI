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
    buildLibraryIndex,
    countActiveFilters,
    DEFAULT_REC_FILTERS,
    EMPTY_LIBRARY_INDEX,
    getTagOptions,
    isInLibrary,
    parseRecFilters,
    passesFilters,
    sortRecs,
} from '@/features/tsuji/recs/filters.ts';
import type { ScoredCandidate } from '@/features/tsuji/recs/rank.ts';

const media = (overrides: Partial<RecMedia> = {}): RecMedia => ({
    id: 1,
    idMal: 11,
    siteUrl: 'https://anilist.co/manga/1',
    title: { userPreferred: 'Jaebeoljip', english: 'Reborn Rich', romaji: 'Jaebeoljip Mangnaeadeul' },
    coverImage: null,
    description: null,
    averageScore: 80,
    meanScore: null,
    popularity: 1000,
    favourites: 10,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: { year: 2020, month: 1, day: 1 },
    tags: [
        { name: 'Revenge', rank: 90 },
        { name: 'Twist', rank: 80, isMediaSpoiler: true },
    ],
    ...overrides,
});

const passes = (item: RecMedia, filters = {}) =>
    passesFilters(item, { ...DEFAULT_REC_FILTERS, ...filters }, EMPTY_LIBRARY_INDEX);

describe('library index', () => {
    const index = buildLibraryIndex([
        { title: 'Solo Leveling', trackRecords: { nodes: [{ trackerId: 2, remoteId: '105398' }] } },
        { title: 'Something Else', trackRecords: { nodes: [{ trackerId: 1, remoteId: '121496' }] } },
        { title: 'Reborn Rich (Official)', trackRecords: { nodes: [] } },
    ]);

    it('matches by AniList tracker id', () =>
        expect(isInLibrary(media({ id: 105398, title: null }), index)).toBe(true));
    it('matches by MAL tracker id', () =>
        expect(isInLibrary(media({ id: 9, idMal: 121496, title: null }), index)).toBe(true));
    it('matches by any normalized title', () => expect(isInLibrary(media({ id: 9, idMal: null }), index)).toBe(true));
    it('does not match unrelated titles', () =>
        expect(
            isInLibrary(
                media({ id: 9, idMal: null, title: { english: 'Other', romaji: null, userPreferred: null } }),
                index,
            ),
        ).toBe(false));
    it('hides library titles by default', () =>
        expect(passesFilters(media({ id: 9, idMal: null }), DEFAULT_REC_FILTERS, index)).toBe(false));
});

describe('passesFilters', () => {
    it('hides novels and one-shots by default', () => {
        expect(passes(media({ format: 'NOVEL' }))).toBe(false);
        expect(passes(media({ format: 'ONE_SHOT' }))).toBe(false);
        expect(passes(media({ format: 'NOVEL' }), { hideNovelOneShot: false })).toBe(true);
    });

    it('filters by type from countryOfOrigin', () => {
        expect(passes(media({ countryOfOrigin: 'TW' }), { types: ['MANHUA'] })).toBe(true);
        expect(passes(media({ countryOfOrigin: 'JP' }), { types: ['MANHWA'] })).toBe(false);
    });

    it('filters by status', () =>
        expect(passes(media({ status: 'FINISHED' }), { statuses: ['RELEASING'] })).toBe(false));

    it('lets unknown chapter counts pass the minimum', () => {
        expect(passes(media({ chapters: null }), { minChapters: 100 })).toBe(true);
        expect(passes(media({ chapters: 40 }), { minChapters: 50 })).toBe(false);
    });

    it('treats a missing score as 0', () => {
        expect(passes(media({ averageScore: null }), { minScore: 60 })).toBe(false);
        expect(passes(media({ averageScore: null }))).toBe(true);
    });

    it('gates adult titles', () => {
        expect(passes(media({ isAdult: true }))).toBe(false);
        expect(passes(media({ isAdult: true }), { showAdult: true })).toBe(true);
    });

    it('applies the hidden-gems popularity floor of 50', () => {
        expect(passes(media({ popularity: 49 }), { hiddenGems: true })).toBe(false);
        expect(passes(media({ popularity: 50 }), { hiddenGems: true })).toBe(true);
    });

    it('requires include tags (non-spoiler) and rejects exclude tags (any)', () => {
        expect(passes(media(), { tags: { Revenge: 'include' } })).toBe(true);
        expect(passes(media(), { tags: { Twist: 'include' } })).toBe(false);
        expect(passes(media(), { tags: { Twist: 'exclude' } })).toBe(false);
        expect(passes(media(), { tags: { Romance: 'exclude' } })).toBe(true);
        expect(
            passesFilters(media(), { ...DEFAULT_REC_FILTERS, tags: { Romance: 'include' } }, EMPTY_LIBRARY_INDEX, {
                applyTagFilters: false,
            }),
        ).toBe(true);
    });
});

const ids = (list: ScoredCandidate[]) => list.map(({ id }) => id);

describe('sortRecs', () => {
    const scored = (id: number, overrides: Partial<ScoredCandidate>) =>
        ({
            ...media({ id }),
            edgeRating: 0,
            sources: ['anilist'],
            vector: new Map(),
            bestMatch: 0,
            gem: 0,
            agreement: false,
            ...overrides,
        }) as ScoredCandidate;
    const items = [
        scored(1, {
            bestMatch: 0.2,
            gem: 0.9,
            averageScore: 90,
            popularity: 10,
            startDate: { year: 2010, month: 1, day: 1 },
        }),
        scored(2, { bestMatch: 0.9, gem: 0.1, averageScore: null, popularity: 500, startDate: null }),
        scored(3, {
            bestMatch: 0.5,
            gem: 0.5,
            averageScore: 70,
            popularity: 100,
            startDate: { year: 2024, month: 5, day: 2 },
        }),
    ];

    it('best match orders by bestMatch', () =>
        expect(ids(sortRecs(items, { sort: 'BEST', hiddenGems: false }))).toEqual([2, 3, 1]));
    it('hidden gems orders by gem score', () =>
        expect(ids(sortRecs(items, { sort: 'BEST', hiddenGems: true }))).toEqual([1, 3, 2]));
    it('top rated puts missing scores last', () =>
        expect(ids(sortRecs(items, { sort: 'SCORE', hiddenGems: false }))).toEqual([1, 3, 2]));
    it('most popular', () =>
        expect(ids(sortRecs(items, { sort: 'POPULARITY', hiddenGems: false }))).toEqual([2, 3, 1]));
    it('newest puts missing dates last', () =>
        expect(ids(sortRecs(items, { sort: 'NEWEST', hiddenGems: false }))).toEqual([3, 1, 2]));
});

describe('parseRecFilters / countActiveFilters', () => {
    it('returns defaults for missing or broken JSON', () => {
        expect(parseRecFilters(undefined)).toEqual(DEFAULT_REC_FILTERS);
        expect(parseRecFilters('{not json')).toEqual(DEFAULT_REC_FILTERS);
    });

    it('keeps valid values and drops unknown ones', () =>
        expect(
            parseRecFilters(
                JSON.stringify({
                    minScore: 70,
                    minChapters: 33,
                    types: ['MANHWA', 'NOPE'],
                    tags: { Revenge: 'include', X: 'maybe' },
                    sort: 'NEWEST',
                }),
            ),
        ).toEqual({
            ...DEFAULT_REC_FILTERS,
            minScore: 70,
            types: ['MANHWA'],
            tags: { Revenge: 'include' },
            sort: 'NEWEST',
        }));

    it('counts filters that differ from the defaults', () =>
        expect(
            countActiveFilters({
                ...DEFAULT_REC_FILTERS,
                minScore: 70,
                tags: { A: 'include', B: 'exclude' },
                sort: 'NEWEST',
            }),
        ).toBe(3));
});

describe('getTagOptions', () => {
    it('lists non-spoiler tags, most common first, adult tags only when allowed', () => {
        const list = [
            media({
                tags: [
                    { name: 'Revenge', rank: 90 },
                    { name: 'Smut', rank: 50, isAdult: true },
                ],
            }),
            media({
                tags: [
                    { name: 'Revenge', rank: 60 },
                    { name: 'Action', rank: 70 },
                    { name: 'Twist', rank: 70, isGeneralSpoiler: true },
                ],
            }),
        ];

        expect(getTagOptions(list, false)).toEqual(['Revenge', 'Action']);
        expect(getTagOptions(list, true)).toEqual(['Revenge', 'Action', 'Smut']);
    });
});
