/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { BakaSeries } from '@/features/tsuji/tags/baka.ts';
import { getBakaFamilies, parseBakaSource } from '@/features/tsuji/tags/baka.ts';
import {
    countFamilies,
    FAMILY_MIN_TITLES,
    getQualifyingFamilies,
    mergeFamilySeries,
    pickWeeklyFamily,
    rankFamilyRow,
} from '@/features/tsuji/forYou/familyRow.ts';

const tagV2 = (id: number, parentId: number | null, extra: Record<string, unknown> = {}) => ({
    id,
    parent_id: parentId,
    series_count: 100,
    weight: 'defining',
    is_spoiler: false,
    ...extra,
});

const seriesTags = (rows: ReturnType<typeof tagV2>[]) =>
    parseBakaSource({ data: { series: [{ id: 1, tags_v2: rows }] } })!.tags;

describe('MangaBaka families of a liked title', () => {
    it('reads the source lookup: the first series and its tags, spoilers left out', () => {
        const found = parseBakaSource({
            status: 200,
            data: {
                source_response: null,
                series: [
                    {
                        id: 377,
                        title: 'Omniscient Reader',
                        source: { anilist: { id: 119257 } },
                        tags_v2: [tagV2(3495, 900), tagV2(42, null, { is_spoiler: true })],
                    },
                ],
            },
        });
        expect(found?.series).toMatchObject({ id: 377, anilistId: 119257 });
        expect(found?.tags.map(({ id }) => id)).toEqual([3495]);
        expect(parseBakaSource({ data: { series: [] } })).toBeNull();
    });

    it('a member tag, or a subtag of one (Level System > Stat Window), puts the series in the family', () => {
        expect(getBakaFamilies(seriesTags([tagV2(3081, 1)]))).toEqual(['system']);
        expect(getBakaFamilies(seriesTags([tagV2(9999, 1171)]))).toEqual(['system']);
        expect(getBakaFamilies(seriesTags([tagV2(2461, 1), tagV2(500, 2)]))).toEqual(['regression', 'dungeon']);
        expect(getBakaFamilies(seriesTags([tagV2(748, 1)]))).toEqual([]);
    });
});

const memberships = (system: number, regression: number) => [
    ...Array.from({ length: system }, () => ['system']),
    ...Array.from({ length: regression }, () => ['regression']),
    null,
    [],
];

const series = (id: number, anilistId: number | null, popularity: number): BakaSeries => ({
    id,
    anilistId,
    malId: null,
    title: `Baka ${id}`,
    english: null,
    romaji: null,
    cover: null,
    type: 'manhwa',
    status: 'releasing',
    rating: 80,
    popularity,
    totalChapters: 100,
    isAdult: false,
    year: 2020,
});

describe('family row', () => {
    it('a family earns a row with 5+ of the liked titles, not 4', () => {
        expect(FAMILY_MIN_TITLES).toBe(5);
        expect(countFamilies(memberships(10, 4))).toEqual({ system: 10, regression: 4 });
        expect(getQualifyingFamilies(countFamilies(memberships(10, 4))).map(({ key }) => key)).toEqual(['system']);
        expect(getQualifyingFamilies(countFamilies(memberships(10, 5))).map(({ key }) => key)).toEqual([
            'system',
            'regression',
        ]);
        expect(pickWeeklyFamily(countFamilies(memberships(4, 4)), '2026-W43')).toBeNull();
    });

    it('one family a week, taking turns', () => {
        const counts = countFamilies(memberships(10, 5));
        const weeks = ['2026-W43', '2026-W44', '2026-W45'].map((week) => pickWeeklyFamily(counts, week)?.label);
        expect(new Set(weeks.slice(0, 2)).size).toBe(2);
        expect(weeks[2]).toBe(weeks[0]);
        expect(pickWeeklyFamily(countFamilies(memberships(10, 0)), '2026-W44')).toEqual({
            key: 'system',
            label: 'System',
        });
    });

    it('sub-searches merged by popularity, each series once, list titles left out', () => {
        const merged = mergeFamilySeries(
            [
                [series(1, 101, 5), series(2, 102, 1)],
                [series(2, 102, 1), series(3, 103, 3), series(4, null, 2)],
            ],
            [103],
        );
        expect(merged.map(({ id }) => id)).toEqual([2, 4, 1]);
    });

    it('ordered by taste (every card matches the family); ties keep MangaBaka popularity', () => {
        const cards = [
            { id: 1, popularity: null, tags: [] },
            { id: 2, popularity: null, tags: [{ name: 'Medicine', rank: 90 }] },
            { id: 3, popularity: null, tags: [] },
        ];
        expect(rankFamilyRow(cards, { Medicine: 1 }).map(({ id }) => id)).toEqual([2, 1, 3]);
        expect(rankFamilyRow(cards, null).map(({ id }) => id)).toEqual([1, 2, 3]);
    });
});
