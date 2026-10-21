/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { BakaSeries, BakaSeriesTag } from '@/features/tsuji/tags/baka.ts';
import { buildBakaSearch } from '@/features/tsuji/tags/baka.ts';
import {
    getSameTagsSearches,
    getTagTfIdf,
    needsSameTagsFill,
    pickDistinctiveBakaTags,
    rankBySameTags,
    SIMILAR_MAX,
    SIMILAR_MIN_VISIBLE,
} from '@/features/tsuji/similar/sameTags.ts';

const tag = (id: number, count: number, weight = 'defining', parentId: number | null = null): BakaSeriesTag => ({
    id,
    parentId,
    count,
    weight,
});

const series = (id: number, popularity: number | null): BakaSeries => ({
    id,
    anilistId: id + 1000,
    malId: null,
    title: `Baka ${id}`,
    english: null,
    romaji: null,
    cover: null,
    type: 'manhwa',
    status: 'releasing',
    rating: 70,
    popularity,
    totalChapters: null,
    isAdult: false,
    year: null,
});

describe('Similar fill', () => {
    it('joins in under 12 visible cards (Investor: 8), never at 12; 24 in all', () => {
        expect(needsSameTagsFill(8)).toBe(true);
        expect(needsSameTagsFill(SIMILAR_MIN_VISIBLE - 1)).toBe(true);
        expect(needsSameTagsFill(SIMILAR_MIN_VISIBLE)).toBe(false);
        expect(SIMILAR_MAX).toBe(24);
    });

    it('the 3 most characteristic tags by tf-idf: strongly carried and rare, but on 50+ series', () => {
        // Investor (r3431): the rarest tags alone (Bride of the Water God) were off-topic.
        const picked = pickDistinctiveBakaTags([
            tag(1, 9000, 'core'),
            tag(2, 300, 'defining'),
            tag(3, 60, 'incidental'),
            tag(4, 120, 'core'),
            tag(5, 30, 'core'),
            tag(6, 800, 'recurrent'),
        ]);
        // 4: 1 x ln(833) = 6.7, 2: .75 x ln(333) = 4.4, 6: .5 x ln(125) = 2.41, 1: ln(11) = 2.40, 3: .25 x ln(1667) = 1.9.
        expect(picked.map(({ id }) => id)).toEqual([4, 2, 6]);
        expect(getTagTfIdf({ weight: 'core', count: 120 })).toBeGreaterThan(
            getTagTfIdf({ weight: 'incidental', count: 60 }),
        );
    });

    it('one search per pair of tags (both tags), all content ratings', () => {
        expect(getSameTagsSearches([4, 2, 1])).toEqual([
            [4, 2],
            [4, 1],
            [2, 1],
        ]);
        const query = new URLSearchParams(
            buildBakaSearch({
                tagIds: [4, 2],
                excludeIds: [],
                types: [],
                sort: 'POPULARITY',
                minScore: 0,
                showAdult: true,
                page: 1,
                limit: 50,
            }),
        );
        expect(query.getAll('tag')).toEqual(['2', '4']);
        expect(query.get('tag_mode')).toBeNull();
        expect(query.getAll('content_rating')).toEqual(['safe', 'suggestive', 'erotica', 'pornographic']);
    });

    it('2+ shared tags (a subtag counts for its parent), most shared first, then popularity; not the series itself', () => {
        const ranked = rankBySameTags(
            [
                { series: series(1, 1), tags: [tag(4, 0)] },
                { series: series(2, 50), tags: [tag(4, 0), tag(2, 0)] },
                { series: series(3, 9), tags: [tag(99, 0, 'core', 6), tag(2, 0)] },
                { series: series(7, 2), tags: [tag(4, 0), tag(2, 0), tag(6, 0)] },
                { series: series(5, 3), tags: [tag(8, 0)] },
            ],
            [4, 2, 6],
            7,
        );
        // 1 shares one tag only: out.
        expect(ranked.map(({ id }) => id)).toEqual([3, 2]);
    });
});
