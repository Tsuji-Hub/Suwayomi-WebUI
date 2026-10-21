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
import { buildBakaSearch, toBakaMedia } from '@/features/tsuji/tags/baka.ts';
import {
    fetchAniListDetails,
    getSearchLimit,
    lookupBakaSource,
    searchBakaSeriesWithTags,
} from '@/features/tsuji/tags/bakaService.ts';
import { compactMedia } from '@/features/tsuji/forYou/weekStore.ts';
import { pickDistinctiveBakaTags, rankBySameTags, SAME_TAGS_STORED } from '@/features/tsuji/similar/sameTags.ts';

export type SameTagsData = { items: RecMedia[] };

const cacheKey = (anilistId: number) => `similar:sametags:v1:${anilistId}`;

/**
 * The Similar fill for a series, cached a week: 2 MangaBaka requests (the series by its AniList id, one search by
 * its 3 most distinctive tags, any of them, all content ratings) and one AniList `id_in` for the cards' details. A
 * series MangaBaka doesn't know, or without usable tags, has no fill (also cached).
 */
export const loadSameTags = async ({
    anilistId,
    signal,
}: {
    anilistId: number;
    signal: AbortSignal;
}): Promise<SameTagsData> => {
    const cached = TsujiCache.get<SameTagsData>(cacheKey(anilistId));
    if (cached) {
        return cached;
    }

    const found = await lookupBakaSource(anilistId, signal);
    const tags = found ? pickDistinctiveBakaTags(found.tags) : [];
    let items: RecMedia[] = [];
    if (found && tags.length) {
        const tagIds = tags.map(({ id }) => id);
        const results = await searchBakaSeriesWithTags(
            buildBakaSearch({
                tagIds,
                tagMode: 'or',
                excludeIds: [],
                types: [],
                sort: 'POPULARITY',
                minScore: 0,
                showAdult: true,
                page: 1,
                limit: getSearchLimit(),
            }),
            signal,
        );
        const series = rankBySameTags(results, tagIds, found.series.id).slice(0, SAME_TAGS_STORED);
        const ids = series.flatMap(({ anilistId: id }) => (id === null || id === anilistId ? [] : [id]));
        // Cards show from MangaBaka alone if AniList doesn't answer.
        const details = ids.length ? await fetchAniListDetails(ids, signal).catch(() => null) : null;
        signal.throwIfAborted();
        items = series
            .filter(({ anilistId: id }) => id !== anilistId)
            .map((each) => toBakaMedia(each, each.anilistId === null ? null : details?.get(each.anilistId)))
            .map(compactMedia);
    }

    signal.throwIfAborted();
    const data: SameTagsData = { items };
    TsujiCache.set(cacheKey(anilistId), data, RECS_CACHE_TTL_MS);
    return data;
};
