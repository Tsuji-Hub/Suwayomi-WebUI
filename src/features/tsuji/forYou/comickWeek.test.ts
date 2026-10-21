/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const cache = new Map<string, unknown>();
vi.mock('@/features/tsuji/services/TsujiCache.ts', () => ({
    TsujiCache: {
        get: (key: string) => cache.get(key) ?? null,
        set: (key: string, value: unknown) => cache.set(key, value),
        remove: (key: string) => cache.delete(key),
    },
}));
const loadComickRecommendations = vi.fn();
const loadComickRecommendationsByTitle = vi.fn();
const searchComick = vi.fn();
vi.mock('@/features/tsuji/comick/ComickService.ts', () => ({
    loadComickRecommendations,
    loadComickRecommendationsByTitle,
    searchComick,
}));

const { loadComickWeek, toLibrarySeeds } = await import('@/features/tsuji/forYou/comickWeek.ts');

const NOW = new Date(2026, 9, 21, 12);
const { signal } = new AbortController();
const card = (id: number) => ({
    // Comick's id range (comickCatalog.ts): apart from the library seeds' -1, -2...
    id: -(1_000_000_000 + id),
    idMal: null,
    siteUrl: null,
    title: { userPreferred: `Comick ${id}`, english: `Comick ${id}`, romaji: null },
    coverImage: null,
    description: null,
    averageScore: 80,
    meanScore: null,
    popularity: 5000,
    favourites: null,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: 100,
    isAdult: false,
    startDate: null,
    tags: [],
    via: 'comick' as const,
});
const recs = (...ids: number[]) => ids.map((id, index) => ({ media: card(id), votes: 10 - index }));

describe('For You while AniList is down, no list known (r3434)', () => {
    beforeEach(() => {
        cache.clear();
        loadComickRecommendations.mockReset();
        loadComickRecommendationsByTitle.mockReset();
        searchComick.mockReset();
    });

    it('library seeds: started titles, most read first, title-only ones without an AniList id', () => {
        const seeds = toLibrarySeeds([
            { title: 'Unread', anilistId: 1, readCount: 0 },
            { title: 'Some', anilistId: null, readCount: 3 },
            { title: 'Most', anilistId: 77, readCount: 200 },
        ]);
        expect(seeds.map(({ mediaId, title, isTitleOnly }) => [mediaId, title, isTitleOnly])).toEqual([
            [77, 'Most', false],
            [-2, 'Some', true],
        ]);
        expect(seeds[0].weight).toBeGreaterThan(seeds[1].weight);
    });

    it('no list: the most read library titles -> Comick, noted as from the library', async () => {
        loadComickRecommendations.mockResolvedValue(recs(1, 2));
        loadComickRecommendationsByTitle.mockResolvedValue(recs(2, 3));
        const result = await loadComickWeek({
            userName: 'ejustice',
            now: NOW,
            signal,
            loadLibrary: async () => [
                { title: 'Most', anilistId: 77, readCount: 200 },
                { title: 'Some', anilistId: null, readCount: 3 },
            ],
        });
        const data = result.kind === 'ready' ? result.data : null;
        expect(data?.fallback).toEqual({ kind: 'library' });
        expect(data?.bestMatches.map(({ id }) => id)).toEqual([-1_000_000_002, -1_000_000_001, -1_000_000_003]);
        expect(loadComickRecommendations).toHaveBeenCalledWith(77, ['Most'], signal);
        expect(loadComickRecommendationsByTitle).toHaveBeenCalledWith('Some', signal);
        expect(searchComick).not.toHaveBeenCalled();
    });

    it('nothing to go on (empty library, or Comick knows none of it): Comick trending, never an error', async () => {
        searchComick.mockResolvedValue([card(5), card(6)]);
        const result = await loadComickWeek({ userName: 'ejustice', now: NOW, signal, loadLibrary: async () => [] });
        const data = result.kind === 'ready' ? result.data : null;
        expect(data?.fallback).toEqual({ kind: 'trending' });
        expect(data?.bestMatches.map(({ id, bestScore }) => [id, bestScore])).toEqual([
            [-1_000_000_005, 2],
            [-1_000_000_006, 1],
        ]);
        expect(new URLSearchParams(searchComick.mock.calls[0][0] as string).get('sort')).toBe('view');

        cache.clear();
        loadComickRecommendations.mockResolvedValue([]);
        const unknown = await loadComickWeek({
            userName: 'ejustice',
            now: NOW,
            signal,
            loadLibrary: async () => [{ title: 'Most', anilistId: 77, readCount: 200 }],
        });
        expect(unknown.kind === 'ready' && unknown.data.fallback).toEqual({ kind: 'trending' });
    });

    it('a list known from the day-long cache: Comick on it, noted as from the list', async () => {
        loadComickRecommendations.mockResolvedValue(recs(1));
        const result = await loadComickWeek({
            userName: 'ejustice',
            now: NOW,
            signal,
            cachedProfile: {
                tags: [],
                tagStats: [],
                likedCount: 1,
                seedPool: [],
                bestSeeds: [{ mediaId: 1000, title: 'Liked', weight: 1 }],
                familySeeds: [],
                listedIds: [1000],
                entryCount: 1,
            },
            loadLibrary: async () => [],
        });
        const data = result.kind === 'ready' ? result.data : null;
        expect(data?.fallback).toEqual({ kind: 'list', listFetchedAt: NOW.getTime() });
        expect(data?.bestMatches.map(({ id }) => id)).toEqual([-1_000_000_001]);
    });
});
