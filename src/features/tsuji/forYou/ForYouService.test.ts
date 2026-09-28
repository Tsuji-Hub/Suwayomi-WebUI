/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
const cache = new Map<string, { value: unknown; ttl: number }>();

vi.mock('@/features/tsuji/services/AniListClient.ts', () => ({
    aniList: { request },
    ANILIST_TIMEOUT_MS: { fast: 4000, slow: 12_000 },
    isAniListTimeout: (error: unknown) => error instanceof Error && error.message === 'timeout',
}));
vi.mock('@/features/tsuji/services/TsujiCache.ts', () => ({
    TsujiCache: {
        get: (key: string) => cache.get(key)?.value ?? null,
        set: (key: string, value: unknown, ttl: number) => cache.set(key, { value, ttl }),
        remove: (key: string) => cache.delete(key),
    },
}));

const { loadForYou } = await import('@/features/tsuji/forYou/ForYouService.ts');

const NOW = new Date(2026, 8, 27, 12); // Sunday: the week ends in 12 h
const tags = [
    { name: 'Revenge', rank: 90 },
    { name: 'Time Skip', rank: 70 },
    { name: 'Chaebol', rank: 60 },
    { name: 'Office', rank: 50 },
];

const tasteResponse = (count: number) => ({
    MediaListCollection: {
        lists: [
            {
                isCustomList: false,
                entries: Array.from({ length: count }, (_, index) => ({
                    mediaId: 1000 + index,
                    status: 'COMPLETED',
                    progress: 100,
                    score: 90 - index,
                    updatedAt: NOW.getTime() / 1000,
                    media: { title: { english: `Read ${index}`, userPreferred: null, romaji: null }, tags },
                })),
            },
        ],
    },
});

const card = (id: number) => ({
    id,
    idMal: null,
    siteUrl: null,
    title: { userPreferred: `Rec ${id}`, english: null, romaji: null },
    coverImage: null,
    description: 'x'.repeat(1000),
    averageScore: 80,
    meanScore: null,
    popularity: 5000,
    favourites: 0,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'FINISHED',
    chapters: 100,
    isAdult: false,
    startDate: null,
    tags: Array.from({ length: 20 }, (_, index) => ({ name: `Tag ${index}`, rank: 90 - index })),
});

type Vars = Record<string, unknown>;

const answer = ({ seedsFail = false, recallFail = false, listSize = 10, combinedRejected = false } = {}) =>
    request.mockImplementation((query: string, variables: Vars) => {
        if (query.includes('TsujiTasteList')) {
            return Promise.resolve(tasteResponse(listSize));
        }
        if (query.includes('TsujiSimilarSeed')) {
            return Promise.resolve({
                Media: {
                    id: variables.id,
                    recommendations: {
                        nodes: [{ rating: 30, mediaRecommendation: card(Number(variables.id) + 5000) }],
                    },
                },
            });
        }
        if (query.includes('TsujiForYouSeeds')) {
            if (combinedRejected) {
                return Promise.reject(new Error('Max query complexity'));
            }
            if (seedsFail) {
                return Promise.reject(new Error('timeout'));
            }
            return Promise.resolve(
                Object.fromEntries(
                    Object.entries(variables).map(([key, id], index) => [
                        `s${key.slice(2)}`,
                        {
                            id,
                            recommendations: {
                                nodes: [
                                    { rating: 50, mediaRecommendation: card(1) },
                                    { rating: 20, mediaRecommendation: card(10 + index) },
                                    // A title already on the list: never recommended back.
                                    { rating: 90, mediaRecommendation: card(1001) },
                                ],
                            },
                        },
                    ]),
                ),
            );
        }
        if (query.includes('TsujiForYouRecall')) {
            return recallFail
                ? Promise.reject(new Error('timeout'))
                : Promise.resolve({ core: { media: [card(1), card(50)] }, rotating: { media: [card(51)] } });
        }
        return Promise.reject(new Error(`unexpected query ${query.slice(0, 40)}`));
    });

const { signal } = new AbortController();

beforeEach(() => {
    request.mockReset();
    cache.clear();
});

describe('loadForYou', () => {
    it('3 AniList requests: list, all seeds at once, recall; cached until next Monday', async () => {
        answer();
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });

        expect(request).toHaveBeenCalledTimes(3);
        expect(result.kind).toBe('ready');
        const data = result.kind === 'ready' ? result.data : null;
        expect(data!.weekKey).toBe('2026-W39');
        expect(data!.seeds).toHaveLength(4);
        expect(data!.profileTags.map(({ name }) => name)).toEqual(['Revenge', 'Time Skip', 'Chaebol', 'Office']);
        const ids = data!.candidates.map(({ id }) => id).sort((a, b) => a - b);
        expect(ids).toEqual([1, 10, 11, 12, 13, 50, 51]);
        expect(data!.candidates.find(({ id }) => id === 1)!.sources).toEqual(['anilist', 'tags']);
        // Trimmed for the cache.
        expect(data!.candidates[0].description).toHaveLength(300);
        expect(data!.candidates[0].tags).toHaveLength(12);
        expect(data!.isPartial).toBe(false);
        expect(cache.get('foryou:week:v1:ejustice:2026-W39')!.ttl).toBe(12 * 60 * 60 * 1000);

        request.mockClear();
        await loadForYou({ userName: 'ejustice', now: NOW, signal });
        expect(request).not.toHaveBeenCalled();
    });

    it('a failed half still shows the other, cached for an hour only', async () => {
        answer({ seedsFail: true });
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });

        expect(result.kind === 'ready' && result.data.candidates.map(({ id }) => id).sort()).toEqual([1, 50, 51]);
        expect(result.kind === 'ready' && result.data.isPartial).toBe(true);
        expect(cache.get('foryou:week:v1:ejustice:2026-W39')!.ttl).toBe(60 * 60 * 1000);
    });

    it('falls back to one request per seed when AniList rejects the combined one', async () => {
        answer({ combinedRejected: true });
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });
        const data = result.kind === 'ready' ? result.data : null;

        // list + combined (rejected) + 4 single seeds + recall
        expect(request).toHaveBeenCalledTimes(7);
        expect(data!.isPartial).toBe(false);
        expect(request.mock.calls.filter(([query]) => String(query).includes('TsujiSimilarSeed'))).toHaveLength(4);
        expect(data!.candidates.filter(({ sources }) => sources.includes('anilist')).length).toBeGreaterThan(0);
    });

    it('both halves failing is an error', async () => {
        answer({ seedsFail: true, recallFail: true });
        await expect(loadForYou({ userName: 'ejustice', now: NOW, signal })).rejects.toThrow('timeout');
    });

    it('an empty list gives "empty", without asking for recommendations', async () => {
        answer({ listSize: 0 });
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });

        expect(result).toEqual({ kind: 'empty', entryCount: 0 });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it("refresh refetches the list and the week; the seeds stay the week's", async () => {
        answer();
        const first = await loadForYou({ userName: 'ejustice', now: NOW, signal });
        const again = await loadForYou({ userName: 'ejustice', now: NOW, force: true, signal });

        expect(request).toHaveBeenCalledTimes(6);
        expect(again.kind === 'ready' && again.data.seeds).toEqual(first.kind === 'ready' && first.data.seeds);
    });
});
