/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import type { TasteEntry } from '@/features/tsuji/forYou/tasteProfile.ts';
import { buildTasteProfile, getEntryWeight } from '@/features/tsuji/forYou/tasteProfile.ts';
import {
    createWeeklyRandom,
    getIsoWeekKey,
    getWeekBounds,
    LAST_WEEK_DEMOTION,
    pickWeeklySeeds,
    pickWeeklyTags,
    sampleWeighted,
} from '@/features/tsuji/forYou/weeklyRotation.ts';
import { getSeedRow, mergeForYouCandidates, rankForYou } from '@/features/tsuji/forYou/forYouCandidates.ts';
import { buildSeedsQuery, parseTasteList } from '@/features/tsuji/forYou/forYouQueries.ts';
import { readShownIds, writeShownIds } from '@/features/tsuji/forYou/forYouHistory.ts';

const NOW = new Date(2026, 8, 27, 12).getTime(); // Sunday 2026-09-27, local time
const DAY_S = 24 * 60 * 60;

const tag = (name: string, rank: number, extra: Partial<RecTag> = {}): RecTag => ({ name, rank, ...extra });

const entry = (overrides: Partial<TasteEntry> = {}): TasteEntry => ({
    mediaId: 1,
    status: 'COMPLETED',
    progress: 100,
    score: 0,
    updatedAt: NOW / 1000,
    title: 'Title',
    tags: [tag('Revenge', 90), tag('Time Skip', 60)],
    ...overrides,
});

const media = (id: number, tags: RecTag[] = [tag('Revenge', 80)], overrides: Partial<RecMedia> = {}): RecMedia => ({
    id,
    idMal: null,
    siteUrl: null,
    title: { userPreferred: `Title ${id}`, english: null, romaji: null },
    coverImage: null,
    description: null,
    averageScore: 75,
    meanScore: null,
    popularity: 10_000,
    favourites: 0,
    countryOfOrigin: 'KR',
    format: 'MANGA',
    status: 'RELEASING',
    chapters: null,
    isAdult: false,
    startDate: null,
    tags,
    ...overrides,
});

describe('taste profile', () => {
    it('weights by status, score, progress and recency', () => {
        const w = (overrides: Partial<TasteEntry>) => getEntryWeight(entry(overrides), NOW);

        expect(w({})).toBeCloseTo(1);
        expect(w({ status: 'REPEATING' })).toBeCloseTo(1.2);
        expect(w({ score: 80 })).toBeCloseTo(1);
        expect(w({ score: 95 })).toBeCloseTo(1.5);
        expect(w({ score: 50 })).toBeCloseTo(0);
        expect(w({ score: 35 })).toBeCloseTo(-0.5);
        expect(w({ status: 'DROPPED', score: 90 })).toBeCloseTo(-0.6);
        // Reading, 5 of the 20 chapters that count fully.
        expect(w({ status: 'CURRENT', progress: 5 })).toBeCloseTo(0.8 * (0.4 + 0.6 * 0.25));
        expect(w({ status: 'CURRENT', progress: 50 })).toBeCloseTo(0.8);
        // Updated 180 days ago counts 75 %, very old never below 50 %.
        expect(w({ updatedAt: NOW / 1000 - 180 * DAY_S })).toBeCloseTo(0.75);
        expect(w({ updatedAt: NOW / 1000 - 5000 * DAY_S })).toBeCloseTo(0.5, 2);
    });

    it('keeps liked content tags (not spoilers or technical ones), dropped tags count against', () => {
        const profile = buildTasteProfile(
            [
                entry({ mediaId: 1, tags: [tag('Revenge', 90), tag('Long Strip', 100, { category: 'Technical' })] }),
                entry({ mediaId: 2, tags: [tag('Revenge', 80), tag('Twist', 90, { isMediaSpoiler: true })] }),
                entry({ mediaId: 3, status: 'DROPPED', tags: [tag('Isekai', 100)] }),
                entry({ mediaId: 4, tags: [tag('Isekai', 50), tag('Cooking', 40)] }),
            ],
            NOW,
        );

        expect(profile.tags.map(({ name }) => name)).toEqual(['Revenge', 'Cooking']);
        expect(profile.tags[0].rank).toBe(100);
        expect(profile.seedPool.map(({ mediaId }) => mediaId)).toEqual([1, 2, 4]);
        expect(profile.listedIds).toEqual([1, 2, 3, 4]);
    });

    it('parses the list: standard lists win over custom ones, bad entries dropped', () => {
        const parsed = parseTasteList({
            MediaListCollection: {
                lists: [
                    {
                        isCustomList: true,
                        entries: [{ mediaId: 1, status: 'DROPPED', progress: 1, score: 10, updatedAt: 5, media: null }],
                    },
                    {
                        isCustomList: false,
                        entries: [
                            {
                                mediaId: 1,
                                status: 'COMPLETED',
                                progress: 80,
                                score: 90,
                                updatedAt: 100,
                                media: {
                                    title: { english: 'Reborn Rich', userPreferred: 'Jaebeoljip', romaji: null },
                                    tags: [tag('Revenge', 90)],
                                },
                            },
                            { mediaId: 2, status: 'PLANNING', progress: 0, score: 0, updatedAt: 0, media: null },
                            null,
                        ],
                    },
                ],
            },
        });

        expect(parsed).toEqual([
            {
                mediaId: 1,
                status: 'COMPLETED',
                progress: 80,
                score: 90,
                updatedAt: 100,
                title: 'Reborn Rich',
                tags: [tag('Revenge', 90)],
            },
        ]);
    });
});

describe('weekly rotation', () => {
    it('ISO week keys, Monday to Sunday, across the year boundary', () => {
        expect(getIsoWeekKey(new Date(2026, 8, 21))).toBe('2026-W39'); // Monday
        expect(getIsoWeekKey(new Date(2026, 8, 27, 23, 59))).toBe('2026-W39'); // Sunday night
        expect(getIsoWeekKey(new Date(2026, 8, 28))).toBe('2026-W40');
        expect(getIsoWeekKey(new Date(2026, 11, 31))).toBe('2026-W53');
        expect(getIsoWeekKey(new Date(2027, 0, 4))).toBe('2027-W01');
        expect(getIsoWeekKey(new Date(2025, 11, 29))).toBe('2026-W01');
    });

    it('week bounds are local Mondays', () => {
        const { start, end } = getWeekBounds(new Date(NOW));
        expect([start.getDay(), start.getDate(), start.getHours()]).toEqual([1, 21, 0]);
        expect([end.getDay(), end.getDate()]).toEqual([1, 28]);
    });

    const pool = Array.from({ length: 30 }, (_, index) => ({
        mediaId: index + 1,
        title: `T${index + 1}`,
        weight: 30 - index,
    }));

    it('same user + week -> same seeds and tags; another week or user -> different', () => {
        const seedsOf = (user: string, week: string) =>
            pickWeeklySeeds(pool, createWeeklyRandom(user, week)).map(({ mediaId }) => mediaId);

        expect(seedsOf('ejustice', '2026-W39')).toEqual(seedsOf('EJustice', '2026-W39'));
        expect(seedsOf('ejustice', '2026-W39')).toHaveLength(4);
        expect(new Set(seedsOf('ejustice', '2026-W39')).size).toBe(4);
        expect(seedsOf('ejustice', '2026-W40')).not.toEqual(seedsOf('ejustice', '2026-W39'));
        expect(seedsOf('someone', '2026-W39')).not.toEqual(seedsOf('ejustice', '2026-W39'));
    });

    it('favours the strongest titles over many weeks, but rotates through the pool', () => {
        const counts = new Map<number, number>();
        for (let week = 1; week <= 52; week += 1) {
            pickWeeklySeeds(pool, createWeeklyRandom('ejustice', `2026-W${week}`)).forEach(({ mediaId }) =>
                counts.set(mediaId, (counts.get(mediaId) ?? 0) + 1),
            );
        }
        const top5 = [1, 2, 3, 4, 5].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);
        const bottom5 = [26, 27, 28, 29, 30].reduce((sum, id) => sum + (counts.get(id) ?? 0), 0);

        expect(top5).toBeGreaterThan(bottom5 * 3);
        expect(counts.size).toBeGreaterThan(20);
    });

    it('core tags every week, rotating tags from the next strongest', () => {
        const tags = Array.from({ length: 20 }, (_, index) => tag(`Tag${index}`, 100 - index * 4));
        const picked = pickWeeklyTags(tags, createWeeklyRandom('ejustice', '2026-W39'));

        expect(picked.core).toEqual(['Tag0', 'Tag1', 'Tag2']);
        expect(picked.rotating).toHaveLength(3);
        picked.rotating.forEach((name) => expect(Number(name.slice(3))).toBeGreaterThanOrEqual(3));
        picked.rotating.forEach((name) => expect(Number(name.slice(3))).toBeLessThan(15));
    });

    it('weighted sampling never repeats and handles small pools', () => {
        const random = createWeeklyRandom('x', 'y');
        expect(sampleWeighted([1, 2], 5, () => 1, random).sort()).toEqual([1, 2]);
        expect(sampleWeighted([1, 2, 3], 2, (item) => (item === 2 ? 0 : 1), random).sort()).toEqual([1, 3]);
    });
});

describe('candidates', () => {
    const seedA = { mediaId: 100, title: 'Seed A', weight: 2 };
    const seedB = { mediaId: 200, title: 'Seed B', weight: 1 };

    const merged = mergeForYouCandidates({
        seeds: [
            {
                seed: seedA,
                recommendations: [
                    { rating: 50, media: media(1) },
                    { rating: 10, media: media(2) },
                    { rating: 30, media: media(200) },
                ],
            },
            {
                seed: seedB,
                recommendations: [
                    { rating: 40, media: media(1) },
                    { rating: -5, media: media(3) },
                    { rating: 20, media: media(9) },
                ],
            },
        ],
        recall: [media(2), media(4), media(9)],
        excludeIds: [9],
    });
    const byId = (id: number) => merged.find((item) => item.id === id)!;

    it('sums seed ratings scaled by seed weight, leaves out listed titles and the seeds', () => {
        expect(merged.map(({ id }) => id).sort()).toEqual([1, 2, 3, 4]);
        expect(byId(1).edgeRating).toBeCloseTo(50 + 40 * 0.5);
        expect(byId(1).seedRatings).toEqual({ 100: 50, 200: 40 });
        expect(byId(3).edgeRating).toBe(0); // downvoted edge clamps to 0
        expect(byId(2).sources).toEqual(['anilist', 'tags']);
        expect(byId(4).sources).toEqual(['tags']);
    });

    it('ranks with the taste profile, demotes last week, and builds seed rows', () => {
        const profile = [tag('Revenge', 100)];
        const ranked = rankForYou(profile, merged);
        const demoted = rankForYou(profile, merged, [1]);
        expect([...ranked].sort((a, b) => b.bestMatch - a.bestMatch)[0].id).toBe(1);
        expect(demoted.find(({ id }) => id === 1)!.bestMatch).toBeCloseTo(
            ranked.find(({ id }) => id === 1)!.bestMatch * LAST_WEEK_DEMOTION,
        );
        expect(getSeedRow(ranked, 100).map(({ id }) => id)).toEqual([1, 2]);
        expect(getSeedRow(ranked, 200).map(({ id }) => id)).toEqual([1, 3]);
    });

    it('one aliased request for every seed', () => {
        const query = buildSeedsQuery(4);
        expect(query).toContain('$id0: Int, $id1: Int, $id2: Int, $id3: Int');
        expect(query.match(/s\d: Media\(id: \$id\d, type: MANGA\)/g)).toHaveLength(4);
    });
});

const createStorage = () => {
    const data = new Map<string, string>();
    return {
        getItem: (key: string) => data.get(key) ?? null,
        setItem: (key: string, value: string) => void data.set(key, value),
    };
};

describe('shown history', () => {
    it('keeps 3 weeks per user, max 12 ids per week', () => {
        const storage = createStorage();
        ['2026-W37', '2026-W38', '2026-W39', '2026-W40'].forEach((week, index) =>
            writeShownIds(
                storage,
                'EJustice',
                week,
                Array.from({ length: 20 }, (_, id) => id + index * 100),
            ),
        );

        expect(readShownIds(storage, 'ejustice', '2026-W37')).toEqual([]);
        expect(readShownIds(storage, 'ejustice', '2026-W38')).toHaveLength(12);
        expect(readShownIds(storage, 'ejustice', '2026-W40')[0]).toBe(300);
        expect(readShownIds(storage, 'other', '2026-W40')).toEqual([]);
    });
});
