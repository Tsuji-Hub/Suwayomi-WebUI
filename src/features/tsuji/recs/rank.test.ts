/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecCandidate, RecSourceId, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import {
    bayesianQuality,
    cosineSimilarity,
    diversify,
    hiddenGemScore,
    includeTagScore,
    minMaxNormalize,
    rankCandidates,
    rerankByIncludeTags,
    toTagVector,
} from '@/features/tsuji/recs/rank.ts';

const tag = (name: string, rank: number, spoiler: Partial<RecTag> = {}): RecTag => ({ name, rank, ...spoiler });

const candidate = (id: number, sources: RecSourceId[], overrides: Partial<RecCandidate> = {}): RecCandidate =>
    ({
        id,
        averageScore: 80,
        meanScore: null,
        popularity: 1000,
        tags: [tag('x', 90)],
        edgeRating: 10,
        sources,
        ...overrides,
    }) as RecCandidate;

describe('minMaxNormalize', () => {
    it('scales to 0..1', () => expect(minMaxNormalize([1, 2, 3])).toEqual([0, 0.5, 1]));
    it('maps all-equal values to 0.5', () => expect(minMaxNormalize([5, 5])).toEqual([0.5, 0.5]));
    it('handles empty input', () => expect(minMaxNormalize([])).toEqual([]));
});

describe('bayesianQuality (Bayesian weighted rating, m = 5000, C = 65)', () => {
    it('blends toward the catalog mean', () => expect(bayesianQuality(80, null, 5000)).toBe(72.5));
    it('falls back to meanScore', () => expect(bayesianQuality(null, 70, 5000)).toBe(67.5));
    it('falls back to C without scores', () => expect(bayesianQuality(null, null, 5000)).toBe(65));
    it('returns C with no votes', () => expect(bayesianQuality(95, null, 0)).toBe(65));
});

describe('tag vectors and cosine', () => {
    it('drops spoiler tags and rank <= 0', () =>
        expect([
            ...toTagVector([
                tag('a', 80),
                tag('b', 90, { isMediaSpoiler: true }),
                tag('c', 70, { isGeneralSpoiler: true }),
                tag('d', 0),
            ]),
        ]).toEqual([['a', 0.8]]));

    it('is 1 for identical, 0 for disjoint or empty vectors', () => {
        const a = toTagVector([tag('x', 60), tag('y', 80)]);

        expect(cosineSimilarity(a, a)).toBeCloseTo(1);
        expect(cosineSimilarity(a, toTagVector([tag('z', 50)]))).toBe(0);
        expect(cosineSimilarity(a, new Map())).toBe(0);
    });

    it('handles partial overlap', () =>
        expect(
            cosineSimilarity(
                new Map([['x', 1]]),
                new Map([
                    ['x', 1],
                    ['y', 1],
                ]),
            ),
        ).toBeCloseTo(Math.SQRT1_2));
});

describe('rankCandidates', () => {
    const seed = [tag('x', 90)];

    it('weights edge 0.5 inside the 0.55 base share', () => {
        const [low, high] = rankCandidates(seed, [
            candidate(1, ['anilist'], { edgeRating: 0 }),
            candidate(2, ['anilist'], { edgeRating: 50 }),
        ]);

        expect(high.bestMatch - low.bestMatch).toBeCloseTo(0.55 * 0.5);
    });

    it('blends agreement at 0.45 and flags AniList + MAL', () => {
        const [solo, both] = rankCandidates(seed, [candidate(1, ['anilist']), candidate(2, ['anilist', 'mal'])]);

        expect(both.agreement).toBe(true);
        expect(solo.agreement).toBe(false);
        expect(both.bestMatch - solo.bestMatch).toBeCloseTo(0.45);
    });

    it('does not count tag recall as a recommender', () => {
        const [recall, edge] = rankCandidates(seed, [candidate(1, ['tags']), candidate(2, ['anilist'])]);

        expect(edge.bestMatch - recall.bestMatch).toBeCloseTo(0.45);
    });

    it('clamps negative edge ratings to 0', () => {
        const [negative, zero] = rankCandidates(seed, [
            candidate(1, ['anilist'], { edgeRating: -20 }),
            candidate(2, ['anilist'], { edgeRating: 0 }),
        ]);

        expect(negative.bestMatch).toBeCloseTo(zero.bestMatch);
    });

    it('returns nothing for no candidates', () => expect(rankCandidates(seed, [])).toEqual([]));
});

describe('hiddenGemScore = quality * (1 - popularity)^2 * (1 + 0.5 * agreement)', () => {
    it('penalizes popularity quadratically', () => {
        expect(hiddenGemScore(1, 0, 0)).toBe(1);
        expect(hiddenGemScore(1, 0.5, 0)).toBeCloseTo(0.25);
        expect(hiddenGemScore(0, 0, 1)).toBe(0);
    });

    it('lifts gems several sources agree on', () => expect(hiddenGemScore(1, 0.5, 1)).toBeCloseTo(0.375));
});

describe('diversify (MMR, lambda 0.7)', () => {
    const items = [
        { id: 'A', relevance: 1, vector: new Map([['x', 1]]) },
        { id: 'B', relevance: 0.95, vector: new Map([['x', 1]]) },
        { id: 'C', relevance: 0.8, vector: new Map([['y', 1]]) },
    ];

    it('prefers a dissimilar title over a near-duplicate', () =>
        expect(diversify(items, (item) => item.relevance).map((item) => item.id)).toEqual(['A', 'C', 'B']));

    it('keeps items past the window in order', () =>
        expect(diversify(items, (item) => item.relevance, 0.7, 2).map((item) => item.id)).toEqual(['A', 'B', 'C']));

    it('leaves lists of two or fewer untouched', () =>
        expect(diversify(items.slice(0, 2), (item) => item.relevance).map((item) => item.id)).toEqual(['A', 'B']));

    it('breaks ties by input order', () => {
        const same = [0, 1, 2].map((id) => ({ id, vector: new Map<string, number>() }));

        expect(diversify(same, () => 1).map((item) => item.id)).toEqual([0, 1, 2]);
    });
});

describe('includeTagScore / rerankByIncludeTags', () => {
    it('is the mean rank/100 over the included tags', () => {
        expect(includeTagScore(['Revenge', 'Regression'], [tag('Revenge', 80), tag('Regression', 60)])).toBeCloseTo(
            0.7,
        );
        expect(includeTagScore(['Revenge', 'Regression'], [tag('Revenge', 80)])).toBeCloseTo(0.4);
    });

    it('ignores spoiler tags', () =>
        expect(includeTagScore(['Revenge'], [tag('Revenge', 80, { isMediaSpoiler: true })])).toBe(0));

    it('sorts a page by score, then popularity', () => {
        const page = [
            { id: 1, popularity: 10, tags: [tag('Revenge', 50)] },
            { id: 2, popularity: 99, tags: [tag('Revenge', 50)] },
            { id: 3, popularity: 1, tags: [tag('Revenge', 90)] },
        ];

        expect(rerankByIncludeTags(page, ['Revenge']).map((media) => media.id)).toEqual([3, 2, 1]);
    });
});
