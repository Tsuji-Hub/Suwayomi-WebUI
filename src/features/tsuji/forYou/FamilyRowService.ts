/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { BAKA_FAMILIES, buildBakaSearch, toBakaMedia } from '@/features/tsuji/tags/baka.ts';
import {
    fetchAniListDetails,
    getBakaFamiliesOf,
    getSearchLimit,
    searchBakaSeries,
} from '@/features/tsuji/tags/bakaService.ts';
import type { ForYouData } from '@/features/tsuji/forYou/ForYouService.ts';
import type { FamilyRef } from '@/features/tsuji/forYou/familyRow.ts';
import {
    countFamilies,
    FAMILY_ROW_STORED,
    mergeFamilySeries,
    pickWeeklyFamily,
    rankFamilyRow,
} from '@/features/tsuji/forYou/familyRow.ts';
import { getWeekBounds } from '@/features/tsuji/forYou/weeklyRotation.ts';
import { compactMedia } from '@/features/tsuji/forYou/weekStore.ts';

export type FamilyRowData = { family: FamilyRef | null; counts: Record<string, number>; items: RecMedia[] };

/** A week whose lookups or searches partly failed is kept an hour, so the next visit fills it in. */
const PARTIAL_TTL_MS = 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 60 * 1000;
/** AniList details for the strongest this many family series (2 `id_in` requests). */
const FAMILY_DETAILS = 100;

const familyKeyOf = (userName: string, weekKey: string) => `foryou:family:v1:${userName.toLowerCase()}:${weekKey}`;

/**
 * This week's family row, built after the week (it never holds the rest of For You up): the 60 strongest liked
 * titles' MangaBaka families (one lookup each, cached a week, on the 180/min queue), this week's family's sub-searches
 * (one per member tag, all comic types, safe ratings; the Adult filter can't add what isn't fetched), AniList details
 * for the cards, ranked by Best match. Cached until next Monday: a revisit asks nothing.
 */
export const loadFamilyRow = async ({
    userName,
    data,
    now = new Date(),
    signal,
}: {
    userName: string;
    data: Pick<ForYouData, 'weekKey' | 'weekStart' | 'familySeeds' | 'listedIds' | 'tasteWeights'>;
    now?: Date;
    signal: AbortSignal;
}): Promise<FamilyRowData> => {
    const cacheKey = familyKeyOf(userName, data.weekKey);
    const cached = TsujiCache.get<FamilyRowData>(cacheKey);
    if (cached) {
        return cached;
    }

    const lookups = await Promise.allSettled(data.familySeeds.map((id) => getBakaFamiliesOf(id, signal)));
    signal.throwIfAborted();
    const counts = countFamilies(lookups.map((result) => (result.status === 'fulfilled' ? result.value : null)));
    let isPartial = lookups.some(({ status }) => status === 'rejected');

    const family = pickWeeklyFamily(counts, data.weekKey);
    let items: RecMedia[] = [];
    if (family) {
        const members = BAKA_FAMILIES.find(({ key }) => key === family.key)?.tags ?? [];
        const pages = await Promise.allSettled(
            members.map(({ id }) =>
                searchBakaSeries(
                    buildBakaSearch({
                        tagIds: [id],
                        excludeIds: [],
                        types: [],
                        sort: 'POPULARITY',
                        minScore: 0,
                        showAdult: false,
                        page: 1,
                        limit: getSearchLimit(),
                    }),
                    signal,
                ),
            ),
        );
        signal.throwIfAborted();
        isPartial ||= pages.some(({ status }) => status === 'rejected');
        const series = mergeFamilySeries(
            pages.map((result) => (result.status === 'fulfilled' ? result.value.series : [])),
            [...data.listedIds, ...data.familySeeds],
        ).slice(0, FAMILY_DETAILS);
        const ids = series.flatMap(({ anilistId }) => (anilistId === null ? [] : [anilistId]));
        const details = new Map<number, RecMedia | null>();
        const batches = await Promise.allSettled(
            [ids.slice(0, 50), ids.slice(50)]
                .filter((batch) => batch.length)
                .map((batch) => fetchAniListDetails(batch, signal)),
        );
        signal.throwIfAborted();
        batches.forEach((result) => {
            if (result.status === 'fulfilled') {
                result.value.forEach((media, id) => details.set(id, media));
            } else {
                isPartial = true;
            }
        });
        const cards = series.map((each) =>
            toBakaMedia(each, each.anilistId === null ? null : details.get(each.anilistId)),
        );
        items = rankFamilyRow(cards, data.tasteWeights).slice(0, FAMILY_ROW_STORED).map(compactMedia);
    }

    const row: FamilyRowData = { family, counts, items };
    const untilNextWeek = getWeekBounds(new Date(data.weekStart)).end.getTime() - now.getTime();
    TsujiCache.set(cacheKey, row, isPartial ? PARTIAL_TTL_MS : Math.max(MIN_TTL_MS, untilNextWeek));
    return row;
};
