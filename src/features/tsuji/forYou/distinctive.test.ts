/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    clampLift,
    getBaseline,
    getDistinctiveTags,
    getLift,
    getTasteAffinity,
    MIN_BASELINE_TITLES,
    toProfileTags,
    toTasteWeights,
} from '@/features/tsuji/forYou/distinctive.ts';
import type { TasteEntry } from '@/features/tsuji/forYou/tasteProfile.ts';
import { buildTasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';

const NOW = Date.UTC(2026, 9, 20);

describe('lift', () => {
    it('is clamped to 0.33..3', () => {
        expect(clampLift(5.4)).toBe(3);
        expect(clampLift(0.1)).toBe(0.33);
        expect(clampLift(1.19)).toBe(1.19);
    });

    it('liked share / baseline share; a tag the baseline never saw gets the cap, not infinity', () => {
        const baseline = { titles: 400, counts: { 'Male Protagonist': 240, Medicine: 8 } };
        expect(getLift({ name: 'Male Protagonist', titles: 58 }, 100, baseline)).toBeCloseTo(0.58 / 0.6);
        expect(getLift({ name: 'Medicine', titles: 11 }, 100, baseline)).toBe(3);
        expect(getLift({ name: 'Unknown', titles: 1 }, 100, baseline)).toBe(3);
        expect(getLift({ name: 'Male Protagonist', titles: 10 }, 100, baseline)).toBe(0.33);
    });

    it('the baseline is the committed snapshot (500 popular KR / CN titles); one under 200 titles means no lift', () => {
        expect(getBaseline()).toMatchObject({ titles: 500 });
        expect(getBaseline()!.counts['Male Protagonist']).toBe(346);
        expect(getBaseline({ titles: 150, counts: {} })).toBeNull();
        expect(MIN_BASELINE_TITLES).toBe(200);
    });
});

describe('distinctive taste profile', () => {
    // r3431 live: 100 liked titles, Male Protagonist on 58 (the snapshot: 69 %), Magic on 50 (45 %), Medicine on 8
    // (1.8 %), Swordplay on 30 (24.6 %). Totals: Male Protagonist 52.2, Magic 40, Swordplay 24, Medicine 6.4.
    const entries: TasteEntry[] = Array.from({ length: 100 }, (_, index) => ({
        mediaId: index + 1,
        status: 'COMPLETED',
        progress: 100,
        score: 0,
        updatedAt: NOW / 1000,
        title: `Liked ${index}`,
        tags: [
            ...(index < 58 ? [{ name: 'Male Protagonist', rank: 90 }] : []),
            ...(index >= 50 ? [{ name: 'Magic', rank: 80 }] : []),
            ...(index < 8 ? [{ name: 'Medicine', rank: 80 }] : []),
            ...(index >= 20 && index < 50 ? [{ name: 'Swordplay', rank: 80 }] : []),
        ],
    }));
    const profile = buildTasteProfile(entries, NOW);
    const baseline = getBaseline()!;

    it('counts liked titles per tag', () => {
        expect(profile.likedCount).toBe(100);
        expect(profile.tagStats.find(({ name }) => name === 'Medicine')).toMatchObject({ titles: 8 });
        expect(profile.tags.map(({ name }) => name)).toEqual(['Male Protagonist', 'Magic', 'Swordplay', 'Medicine']);
    });

    it('weight = total x lift^2 against the snapshot: the generic tag drops from first to last', () => {
        // Medicine 6.4 x 3^2 = 57.6, Magic 40 x 1.12^2 = 49.6, Swordplay 24 x 1.22^2 = 35.7, Male Protagonist
        // 52.2 x 0.84^2 = 36.6.
        const names = getDistinctiveTags(profile.tagStats, profile.likedCount, baseline).map(({ name }) => name);
        expect(names).toEqual(['Medicine', 'Magic', 'Male Protagonist', 'Swordplay']);
        expect(names.indexOf('Male Protagonist')).toBeGreaterThan(0);
    });

    it('without a baseline the totals alone order the tags', () =>
        expect(getDistinctiveTags(profile.tagStats, profile.likedCount, null)[0].name).toBe('Male Protagonist'));

    it('profile tags (rank 1-100) and weights (strongest 1) for Discover', () => {
        const tags = getDistinctiveTags(profile.tagStats, profile.likedCount, baseline);
        expect(toProfileTags(tags)[0]).toEqual({ name: 'Medicine', rank: 100 });
        const weights = toTasteWeights(tags);
        expect(weights.Medicine).toBe(1);
        expect(
            getTasteAffinity(
                {
                    tags: [
                        { name: 'Medicine', rank: 50 },
                        { name: 'Nope', rank: 90 },
                    ],
                },
                weights,
            ),
        ).toBe(0.5);
    });
});
