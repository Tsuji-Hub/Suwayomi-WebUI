/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import {
    buildTagBaseline,
    clampLift,
    getDistinctiveTags,
    getLift,
    getTasteAffinity,
    MIN_BASELINE_TITLES,
    pickBaseline,
    toProfileTags,
    toTasteWeights,
} from '@/features/tsuji/forYou/distinctive.ts';
import type { TasteEntry } from '@/features/tsuji/forYou/tasteProfile.ts';
import { buildTasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';

const NOW = Date.UTC(2026, 9, 20);

/** A pool of `size` titles where `shares[tag]` of them carry the tag. */
const pool = (size: number, shares: Record<string, number>) =>
    Array.from({ length: size }, (_, index) => ({
        id: index + 1,
        tags: Object.entries(shares)
            .filter(([, share]) => index < Math.round(share * size))
            .map(([name]): RecTag => ({ name, rank: 80 })),
    }));

describe('lift', () => {
    it('is clamped to 0.5..3', () => {
        expect(clampLift(5.4)).toBe(3);
        expect(clampLift(0.1)).toBe(0.5);
        expect(clampLift(1.19)).toBe(1.19);
    });

    it('liked share / baseline share; a tag the baseline never saw gets the cap, not infinity', () => {
        const baseline = { titles: 400, counts: { 'Male Protagonist': 192, Medicine: 8 } };
        expect(getLift({ name: 'Male Protagonist', titles: 57 }, 100, baseline)).toBeCloseTo(0.57 / 0.48);
        expect(getLift({ name: 'Medicine', titles: 11 }, 100, baseline)).toBe(3);
        expect(getLift({ name: 'Unknown', titles: 1 }, 100, baseline)).toBe(3);
        expect(getLift({ name: 'Male Protagonist', titles: 10 }, 100, baseline)).toBe(0.5);
    });

    it('a baseline needs 200 titles: the pool first, else the snapshot, else none', () => {
        const small = buildTagBaseline(pool(150, { Action: 0.5 }));
        const big = buildTagBaseline(pool(250, { Action: 0.5 }));
        expect(big).toMatchObject({ titles: 250, counts: { Action: 125 } });
        expect(pickBaseline(small, big)).toBe(big);
        expect(pickBaseline(big, small)).toBe(big);
        expect(pickBaseline(small, { titles: 0, counts: {} })).toBeNull();
        expect(MIN_BASELINE_TITLES).toBe(200);
        // Each title once.
        expect(buildTagBaseline([...pool(3, { A: 1 }), ...pool(3, { A: 1 })]).counts.A).toBe(3);
    });
});

describe('distinctive taste profile', () => {
    // 100 liked titles: Male Protagonist on 57, Medicine and Swordplay on 30, Action on all; the pool: 48 %, 2 %, 7 %,
    // 90 %. Totals: Action 60, Male Protagonist 51.3, Medicine and Swordplay 24 each.
    const entries: TasteEntry[] = Array.from({ length: 100 }, (_, index) => ({
        mediaId: index + 1,
        status: 'COMPLETED',
        progress: 100,
        score: 0,
        updatedAt: NOW / 1000,
        title: `Liked ${index}`,
        tags: [
            ...(index < 57 ? [{ name: 'Male Protagonist', rank: 90 }] : []),
            ...(index < 30 ? [{ name: 'Medicine', rank: 80 }] : []),
            ...(index >= 50 && index < 80 ? [{ name: 'Swordplay', rank: 80 }] : []),
            { name: 'Action', rank: 60 },
        ],
    }));
    const profile = buildTasteProfile(entries, NOW);
    const baseline = buildTagBaseline(
        pool(400, { 'Male Protagonist': 0.48, Medicine: 0.02, Swordplay: 0.07, Action: 0.9 }),
    );

    it('counts liked titles per tag', () => {
        expect(profile.likedCount).toBe(100);
        expect(profile.tagStats.find(({ name }) => name === 'Medicine')).toMatchObject({ titles: 30 });
        expect(profile.tags.map(({ name }) => name)).toEqual(['Action', 'Male Protagonist', 'Medicine', 'Swordplay']);
    });

    it('weight = total x lift: the generic tags drop below the distinctive ones', () => {
        // Medicine / Swordplay 24 x 3 = 72, Action 60 x 1.11 = 66.7, Male Protagonist 51.3 x 1.19 = 61.
        const names = getDistinctiveTags(profile.tagStats, profile.likedCount, baseline).map(({ name }) => name);
        expect(names).toEqual(['Medicine', 'Swordplay', 'Action', 'Male Protagonist']);
    });

    it('without a baseline the totals alone order the tags', () =>
        expect(getDistinctiveTags(profile.tagStats, profile.likedCount, null)[0].name).toBe('Action'));

    it('profile tags (rank 1-100) and weights (strongest 1) for Discover', () => {
        const tags = getDistinctiveTags(profile.tagStats, profile.likedCount, baseline);
        expect(toProfileTags(tags).slice(0, 2)).toEqual([
            { name: 'Medicine', rank: 100 },
            { name: 'Swordplay', rank: 100 },
        ]);
        const weights = toTasteWeights(tags);
        expect(weights.Swordplay).toBe(1);
        expect(weights['Male Protagonist']).toBeCloseTo(61 / 72, 2);
        expect(
            getTasteAffinity(
                {
                    tags: [
                        { name: 'Swordplay', rank: 50 },
                        { name: 'Nope', rank: 90 },
                    ],
                },
                weights,
            ),
        ).toBe(0.5);
    });
});
