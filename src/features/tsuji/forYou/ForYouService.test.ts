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

const answer = ({
    seedsFail = false,
    recallFail = false,
    bestFail = false,
    listSize = 10,
    combinedRejected = false,
} = {}) =>
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
        if (query.includes('TsujiForYouBest')) {
            if (bestFail) {
                return Promise.reject(new Error('timeout'));
            }
            return Promise.resolve(
                Object.fromEntries(
                    Object.entries(variables).map(([key, id]) => [
                        `s${key.slice(2)}`,
                        {
                            id,
                            recommendations: {
                                nodes: [
                                    // Recommended by every best seed: the top best match.
                                    { rating: 40, mediaRecommendation: card(700) },
                                    { rating: 10, mediaRecommendation: card(700 + Number(id)) },
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
    it('list, all seeds at once, recall, and Best matches 8 seeds a request; cached until next Monday', async () => {
        answer();
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });

        // 10 liked titles: 2 Best matches requests (8 + 2 seeds).
        expect(request).toHaveBeenCalledTimes(5);
        expect(result.kind).toBe('ready');
        const data = result.kind === 'ready' ? result.data : null;
        expect(data!.weekKey).toBe('2026-W39');
        expect(data!.seeds).toHaveLength(4);
        expect(data!.profileTags.map(({ name }) => name)).toEqual(['Revenge', 'Time Skip', 'Chaebol', 'Office']);
        const ids = data!.candidates.map(({ id }) => id).sort((a, b) => a - b);
        expect(ids).toEqual([1, 10, 11, 12, 13, 50, 51]);
        expect(data!.candidates.find(({ id }) => id === 1)!.sources).toEqual(['anilist', 'tags']);
        // Trimmed for the cache.
        expect(data!.candidates[0].description).toHaveLength(160);
        expect(data!.candidates[0].tags).toHaveLength(8);
        expect(data!.isPartial).toBe(false);
        expect(cache.get('foryou:week:v4:ejustice:2026-W39')!.ttl).toBe(12 * 60 * 60 * 1000);
        expect(data!.bestSeeds).toHaveLength(10);
        expect(data!.bestMatches[0]).toMatchObject({ id: 700 });
        expect(data!.bestMatches.some(({ id }) => id === 1001)).toBe(false);

        request.mockClear();
        await loadForYou({ userName: 'ejustice', now: NOW, signal });
        expect(request).not.toHaveBeenCalled();
    });

    it('keeps the taste weights for Discover and the family row inputs; a pool under 200 titles sets no baseline', async () => {
        answer();
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });
        const data = result.kind === 'ready' ? result.data : null;

        expect(cache.get('foryou:weights:v1:ejustice')!.value).toEqual(data!.tasteWeights);
        expect(data!.tasteWeights.Revenge).toBe(1);
        expect(cache.has('foryou:baseline:v1:ejustice')).toBe(false);
        expect(data!.familySeeds).toEqual([1000, 1001, 1002, 1003, 1004, 1005, 1006, 1007, 1008, 1009]);
        expect(data!.listedIds).toHaveLength(10);

        // Evicted weights come back from the stored week, without a request.
        cache.delete('foryou:weights:v1:ejustice');
        request.mockClear();
        await loadForYou({ userName: 'ejustice', now: NOW, signal });
        expect(request).not.toHaveBeenCalled();
        expect(cache.get('foryou:weights:v1:ejustice')!.value).toEqual(data!.tasteWeights);
    });

    it("recall tags lean on last week's pool: a tag every title carries drops, a rare one rises", async () => {
        answer();
        cache.set('foryou:baseline:v1:ejustice', {
            value: { titles: 300, counts: { Revenge: 300, 'Time Skip': 300, Chaebol: 3, Office: 300 } },
            ttl: 0,
        });
        await loadForYou({ userName: 'ejustice', now: NOW, signal });
        const recall = request.mock.calls.find(([query]) => String(query).includes('TsujiForYouRecall'))!;
        expect((recall[1] as Vars).core).toEqual(['Chaebol', 'Revenge', 'Time Skip']);
    });

    it('a failed half still shows the other, cached for an hour only', async () => {
        answer({ seedsFail: true });
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });

        expect(result.kind === 'ready' && result.data.candidates.map(({ id }) => id).sort()).toEqual([1, 50, 51]);
        expect(result.kind === 'ready' && result.data.isPartial).toBe(true);
        expect(cache.get('foryou:week:v4:ejustice:2026-W39')!.ttl).toBe(60 * 60 * 1000);
    });

    it('falls back to one request per seed when AniList rejects the combined one', async () => {
        answer({ combinedRejected: true });
        const result = await loadForYou({ userName: 'ejustice', now: NOW, signal });
        const data = result.kind === 'ready' ? result.data : null;

        // list + combined (rejected) + 4 single seeds + recall + 2 Best matches
        expect(request).toHaveBeenCalledTimes(9);
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

        expect(request).toHaveBeenCalledTimes(10);
        expect(again.kind === 'ready' && again.data.seeds).toEqual(first.kind === 'ready' && first.data.seeds);
    });

    it('Best matches: 40 seeds take 5 requests a week, none on a revisit; a failed batch makes the week partial', async () => {
        answer({ listSize: 50 });
        await loadForYou({ userName: 'ejustice', now: NOW, signal });
        const best = () => request.mock.calls.filter(([query]) => String(query).includes('TsujiForYouBest'));
        expect(best()).toHaveLength(5);
        expect(best().every(([, variables]) => Object.keys(variables as Vars).length <= 8)).toBe(true);

        request.mockClear();
        await loadForYou({ userName: 'ejustice', now: NOW, signal });
        expect(request).not.toHaveBeenCalled();

        cache.clear();
        answer({ bestFail: true });
        const partial = await loadForYou({ userName: 'ejustice', now: NOW, signal });
        expect(partial.kind === 'ready' && partial.data.isPartial).toBe(true);
        expect(partial.kind === 'ready' && partial.data.bestMatches).toEqual([]);
    });
});
