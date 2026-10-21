/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { BestMatch, ForYouCandidate } from '@/features/tsuji/forYou/forYouCandidates.ts';
import type { ForYouData } from '@/features/tsuji/forYou/ForYouService.ts';
import { fromStoredWeek, MAX_WEEK_CHARS, toStoredWeek } from '@/features/tsuji/forYou/weekStore.ts';
import { buildLibraryIndex, isInLibrary } from '@/features/tsuji/recs/filters.ts';

/** A title as AniList sends it: long synopsis, 20 tags with all their flags, long cover URL. */
const fullMedia = (id: number): RecMedia => ({
    id,
    idMal: id + 1,
    siteUrl: `https://anilist.co/manga/${id}`,
    title: { userPreferred: `Title ${id} userPreferred`, english: `Title ${id} English`, romaji: `Title ${id} Romaji` },
    coverImage: { large: `https://s4.anilist.co/file/anilistcdn/media/manga/cover/large/bx${id}-AbCdEfGhIjKl.jpg` },
    description: `Synopsis ${id} `.repeat(150),
    averageScore: 70,
    meanScore: 71,
    popularity: 12_345,
    favourites: 321,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: { year: 2020, month: 1, day: 1 },
    tags: Array.from({ length: 20 }, (_, index) => ({
        name: `Tag number ${index}`,
        rank: 95 - index,
        category: 'Theme-Action',
        isMediaSpoiler: index === 0,
        isGeneralSpoiler: false,
        isAdult: false,
    })),
});

const candidate = (id: number): ForYouCandidate => ({
    ...fullMedia(id),
    edgeRating: 123.456,
    sources: ['anilist'],
    seedRatings: { 1000: 40, 1001: 20 },
});
const best = (id: number): BestMatch => ({ ...candidate(id), bestScore: 77.777 });

const week = (candidates: number, matches: number, overlap = 0): ForYouData => ({
    weekKey: '2026-W43',
    weekStart: 0,
    seeds: [{ mediaId: 1000, title: 'Liked 0' }],
    profileTags: [{ name: 'Revenge', rank: 100 }],
    tasteWeights: { Revenge: 1 },
    weekTags: { core: ['Revenge'], rotating: [] },
    entryCount: 329,
    candidates: Array.from({ length: candidates }, (_, index) => candidate(index + 1)),
    bestSeeds: [{ mediaId: 1000, title: 'Liked 0', weight: 1.2 }],
    bestMatches: Array.from({ length: matches }, (_, index) => best(index + 1 + candidates - overlap)),
    familySeeds: Array.from({ length: 60 }, (_, index) => 1000 + index),
    // A heavy reader's list (1,000 titles) still fits.
    listedIds: Array.from({ length: 1000 }, (_, index) => 100_000 + index),
    isPartial: false,
});

describe('stored week', () => {
    it('a full week (120 picks + 120 best matches) fits the cache; it did not as full media', () => {
        const data = week(120, 120, 20);
        expect(JSON.stringify(data).length).toBeGreaterThan(300_000);
        const stored = toStoredWeek(data);
        expect(JSON.stringify(stored).length).toBeLessThan(MAX_WEEK_CHARS);
        // Shared titles are stored once.
        expect(stored.media).toHaveLength(120 + 120 - 20);
        expect(stored.candidates).toHaveLength(120);
        expect(stored.bestMatches).toHaveLength(120);
    });

    it('round trip keeps ids, order, scores and seeds; content tags only, name and rank', () => {
        const data = week(3, 2, 1);
        const back = fromStoredWeek(toStoredWeek(data));
        expect(back.candidates.map(({ id }) => id)).toEqual([1, 2, 3]);
        expect(back.bestMatches.map(({ id, bestScore }) => [id, bestScore])).toEqual([
            [3, 77.78],
            [4, 77.78],
        ]);
        expect(back.bestMatches[0].seedRatings).toEqual({ 1000: 40, 1001: 20 });
        expect(back.candidates[0]).toMatchObject({
            idMal: 2,
            averageScore: 70,
            popularity: 12_345,
            edgeRating: 123.46,
        });
        expect(back.candidates[0].tags).toHaveLength(8);
        expect(back.candidates[0].tags?.[0]).toEqual({ name: 'Tag number 1', rank: 94 });
        expect(back.candidates[0].description).toHaveLength(160);
        expect(back.entryCount).toBe(329);
    });

    it('a week too big even compact is cut down, weakest first, until it fits', () => {
        const stored = toStoredWeek(week(800, 800));
        expect(JSON.stringify(stored).length).toBeLessThan(MAX_WEEK_CHARS);
        expect(stored.candidates[0].id).toBe(1);
        expect(stored.bestMatches[0].id).toBe(801);
        expect(stored.candidates.length).toBeLessThan(800);
    });
});

describe('library index', () => {
    it('a library title not started yet is in the index, matched through its AniList track record only', () => {
        const index = buildLibraryIndex([
            {
                title: 'Sword King in a Women’s World (Plan to Read)',
                trackRecords: { nodes: [{ trackerId: 2, remoteId: '116027' }] },
            },
        ]);
        const swordKing = {
            id: 116027,
            idMal: null,
            title: { userPreferred: 'Another Name', english: null, romaji: null },
        };
        expect(isInLibrary(swordKing, index)).toBe(true);
    });
});
