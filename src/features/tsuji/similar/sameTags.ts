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
 * fills in with titles sharing the series' most distinctive tags (the ones fewest series carry), labeled
 * "Same tags as <title>", up to 24 cards in all.
 */

/** Fewer visible cards than this and the fill joins in. */
export const SIMILAR_MIN_VISIBLE = 12;
/** Recommendations and fill together. */
export const SIMILAR_MAX = 24;
/** Distinctive tags searched (OR). */
export const SAME_TAGS_COUNT = 3;
/** A tag on fewer series than this finds next to nothing (and is often a one-off). */
export const SAME_TAGS_MIN_SERIES = 25;
/** Fill titles kept (filters run at render). */
export const SAME_TAGS_STORED = 30;

/** Weights that say a tag is really what the series is about; weaker ones only top up. */
const STRONG_WEIGHTS = new Set(['core', 'defining', 'recurrent']);

export const needsSameTagsFill = (visibleCount: number): boolean => visibleCount < SIMILAR_MIN_VISIBLE;

/** The series' most distinctive tags: lowest global frequency first, strongly weighted tags before the rest. */
export const pickDistinctiveBakaTags = (tags: BakaSeriesTag[]): BakaSeriesTag[] => {
    const usable = tags
        .filter(({ count }) => count >= SAME_TAGS_MIN_SERIES)
        .sort((a, b) => a.count - b.count || a.id - b.id);
    const strong = usable.filter(({ weight }) => STRONG_WEIGHTS.has(weight ?? ''));
    const rest = usable.filter(({ weight }) => !STRONG_WEIGHTS.has(weight ?? ''));
    return [...strong, ...rest].slice(0, SAME_TAGS_COUNT);
};

/** Search results by how many of the tags they share, then MangaBaka popularity; the series itself left out. */
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
        .filter(({ overlap }) => overlap > 0)
        .sort(
            (a, b) =>
                b.overlap - a.overlap ||
                (a.series.popularity ?? Number.POSITIVE_INFINITY) - (b.series.popularity ?? Number.POSITIVE_INFINITY) ||
                a.series.id - b.series.id,
        )
        .map(({ series }) => series);
};
