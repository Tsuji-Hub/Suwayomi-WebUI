/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { RECS_CACHE_TTL_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { BakaSeries } from '@/features/tsuji/tags/baka.ts';
import { buildBakaSearch, toBakaMedia } from '@/features/tsuji/tags/baka.ts';
import {
    fetchAniListDetails,
    getSearchLimit,
    lookupBakaSource,
    searchBakaSeriesWithTags,
} from '@/features/tsuji/tags/bakaService.ts';
import { compactMedia } from '@/features/tsuji/forYou/weekStore.ts';
import {
    getSameTagsSearches,
    pickDistinctiveBakaTags,
    rankBySameTags,
    SAME_TAGS_STORED,
} from '@/features/tsuji/similar/sameTags.ts';

export type SameTagsData = { items: RecMedia[] };

// v2 (brief #14 fix): tf-idf tags, 2+ shared, searched until enough cards survive.
const cacheKey = (anilistId: number) => `similar:sametags:v2:${anilistId}`;
/** After the 3 pair searches, one more page of the first pair if the fill is still short. */
const MAX_SEARCHES = 4;

/**
 * The Similar fill for a series, cached a week: the series on MangaBaka by its AniList id, then one search per pair
 * of its 3 most characteristic tags (both tags, all content ratings) until `needed` cards pass `isVisible` (at most
 * 4 searches; usually 1-2), and one AniList `id_in` for the cards' details. A series MangaBaka doesn't know, or
 * without usable tags, has no fill (also cached).
 */
export const loadSameTags = async ({
    anilistId,
    needed,
    isVisible,
    signal,
}: {
    anilistId: number;
    needed: number;
    isVisible: (media: RecMedia) => boolean;
    signal: AbortSignal;
}): Promise<SameTagsData> => {
    const cached = TsujiCache.get<SameTagsData>(cacheKey(anilistId));
    if (cached) {
        return cached;
    }

    const found = await lookupBakaSource(anilistId, signal);
    const tagIds = (found ? pickDistinctiveBakaTags(found.tags) : []).map(({ id }) => id);
    const bakaId = found?.series.id ?? 0;
    const pairs = getSameTagsSearches(tagIds);
    const searches = [
        ...pairs.map((pair) => ({ pair, page: 1 })),
        ...pairs.slice(0, 1).map((pair) => ({ pair, page: 2 })),
    ];
    const results: Awaited<ReturnType<typeof searchBakaSeriesWithTags>> = [];
    let series: BakaSeries[] = [];
    for (const { pair, page } of searches.slice(0, MAX_SEARCHES)) {
        // One search at a time: most series need one or two.
        // oxlint-disable-next-line no-await-in-loop
        const answer = await searchBakaSeriesWithTags(
            buildBakaSearch({
                tagIds: pair,
                excludeIds: [],
                types: [],
                sort: 'POPULARITY',
                minScore: 0,
                showAdult: true,
                page,
                limit: getSearchLimit(),
            }),
            signal,
        );
        results.push(...answer);
        series = rankBySameTags(results, tagIds, bakaId).filter(({ anilistId: id }) => id !== anilistId);
        if (series.map((each) => toBakaMedia(each)).filter(isVisible).length >= needed) {
            break;
        }
    }

    series = series.slice(0, SAME_TAGS_STORED);
    const ids = series.flatMap(({ anilistId: id }) => (id === null ? [] : [id]));
    // Cards show from MangaBaka alone if AniList doesn't answer.
    const details = ids.length ? await fetchAniListDetails(ids, signal).catch(() => null) : null;
    signal.throwIfAborted();
    const data: SameTagsData = {
        items: series
            .map((each) => toBakaMedia(each, each.anilistId === null ? null : details?.get(each.anilistId)))
            .map(compactMedia),
    };
    TsujiCache.set(cacheKey(anilistId), data, RECS_CACHE_TTL_MS);
    return data;
};
