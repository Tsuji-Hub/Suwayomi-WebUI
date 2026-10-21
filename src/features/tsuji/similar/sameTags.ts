/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { BakaSeries, BakaSeriesTag } from '@/features/tsuji/tags/baka.ts';
import { getBakaTagIds } from '@/features/tsuji/tags/baka.ts';

/*
 * Similar never runs dry (brief #14): when AniList's and MAL's recommendations leave fewer than 12 cards, MangaBaka
 * fills in with titles sharing at least 2 of the series' 3 most characteristic tags (tf-idf: how strongly the
 * series carries a tag x how rare the tag is, among tags on 50+ series; the rarest alone were off-topic in r3431),
 * labeled "Same tags as <title>", up to 24 cards in all.
 */

/** Fewer visible cards than this and the fill joins in. */
export const SIMILAR_MIN_VISIBLE = 12;
/** Recommendations and fill together. */
export const SIMILAR_MAX = 24;
/** Characteristic tags picked. */
export const SAME_TAGS_COUNT = 3;
/** Tags shared at least. */
export const SAME_TAGS_MIN_OVERLAP = 2;
/** A tag on fewer series than this is a one-off, not what the series is about. */
export const SAME_TAGS_MIN_SERIES = 50;
/** Fill titles kept (filters run at render). */
export const SAME_TAGS_STORED = 40;
/** Roughly how many series MangaBaka has (the idf's N; only the order of the tags depends on it). */
const BAKA_SERIES_TOTAL = 100_000;

/** How strongly MangaBaka says the series carries a tag (its tf). */
const WEIGHT_SCORE: Record<string, number> = {
    core: 1,
    defining: 0.75,
    recurrent: 0.5,
    incidental: 0.25,
    unweighted: 0.1,
};

export const needsSameTagsFill = (visibleCount: number): boolean => visibleCount < SIMILAR_MIN_VISIBLE;

export const getTagTfIdf = ({ weight, count }: Pick<BakaSeriesTag, 'weight' | 'count'>): number =>
    (WEIGHT_SCORE[weight ?? ''] ?? WEIGHT_SCORE.unweighted) * Math.log(BAKA_SERIES_TOTAL / Math.max(1, count));

/** The series' most characteristic tags by tf-idf, among tags on 50+ series. */
export const pickDistinctiveBakaTags = (tags: BakaSeriesTag[]): BakaSeriesTag[] =>
    tags
        .filter(({ count }) => count >= SAME_TAGS_MIN_SERIES)
        .map((tag) => ({ tag, score: getTagTfIdf(tag) }))
        .sort((a, b) => b.score - a.score || a.tag.id - b.tag.id)
        .slice(0, SAME_TAGS_COUNT)
        .map(({ tag }) => tag);

/** The searches, in order: every pair of the tags (AND), so each result shares 2 of them. */
export const getSameTagsSearches = (tagIds: number[]): number[][] =>
    tagIds.flatMap((first, index) => tagIds.slice(index + 1).map((second) => [first, second]));

/** Search results with 2+ of the tags, by how many they share, then MangaBaka popularity; the series left out. */
export const rankBySameTags = (
    results: { series: BakaSeries; tags: BakaSeriesTag[] }[],
    tagIds: number[],
    excludeBakaId: number,
): BakaSeries[] => {
    const seen = new Set<number>();
    return results
        .filter(({ series }) => {
            if (series.id === excludeBakaId || seen.has(series.id)) {
                return false;
            }
            seen.add(series.id);
            return true;
        })
        .map(({ series, tags }) => {
            const ids = getBakaTagIds(tags);
            return { series, overlap: tagIds.filter((id) => ids.has(id)).length };
        })
        .filter(({ overlap }) => overlap >= SAME_TAGS_MIN_OVERLAP)
        .sort(
            (a, b) =>
                b.overlap - a.overlap ||
                (a.series.popularity ?? Number.POSITIVE_INFINITY) - (b.series.popularity ?? Number.POSITIVE_INFINITY) ||
                a.series.id - b.series.id,
        )
        .map(({ series }) => series);
};
