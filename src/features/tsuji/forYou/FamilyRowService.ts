/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { BakaSeries } from '@/features/tsuji/tags/baka.ts';
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
    FAMILY_MAX_PAGES,
    FAMILY_ROW_MIN,
    FAMILY_ROW_STORED,
    mergeFamilySeries,
    pickWeeklyFamily,
    rankFamilyRow,
} from '@/features/tsuji/forYou/familyRow.ts';
import { getWeekBounds } from '@/features/tsuji/forYou/weeklyRotation.ts';
import { compactMedia } from '@/features/tsuji/forYou/weekStore.ts';

export type FamilyRowData = { family: FamilyRef | null; counts: Record<string, number>; items: RecMedia[] };

type FamilyInput = Pick<ForYouData, 'weekKey' | 'weekStart' | 'familySeeds' | 'listedIds' | 'tasteWeights'>;

/** A week whose lookups or searches partly failed is kept an hour, so the next visit fills it in. */
const PARTIAL_TTL_MS = 60 * 60 * 1000;
const MIN_TTL_MS = 60 * 60 * 1000;
const DETAILS_BATCH = 50;

// v2 (brief #14 fix): paged until 10+ cards are visible; v1 rows could hold 7.
const familyKeyOf = (userName: string, weekKey: string) => `foryou:family:v2:${userName.toLowerCase()}:${weekKey}`;

/** AniList details for these ids, 50 a request, each batch tried twice (titles and taste need them). */
const loadDetails = async (ids: number[]): Promise<{ details: Map<number, RecMedia | null>; isPartial: boolean }> => {
    const details = new Map<number, RecMedia | null>();
    const batches = Array.from({ length: Math.ceil(ids.length / DETAILS_BATCH) }, (_, index) =>
        ids.slice(index * DETAILS_BATCH, (index + 1) * DETAILS_BATCH),
    );
    const results = await Promise.allSettled(
        batches.map((batch) => fetchAniListDetails(batch).catch(() => fetchAniListDetails(batch))),
    );
    results.forEach((result) => {
        if (result.status === 'fulfilled') {
            result.value.forEach((media, id) => details.set(id, media));
        }
    });
    return { details, isPartial: results.some(({ status }) => status === 'rejected') };
};

const build = async (userName: string, data: FamilyInput, isVisible: (media: RecMedia) => boolean, now: Date) => {
    const lookups = await Promise.allSettled(data.familySeeds.map((id) => getBakaFamiliesOf(id)));
    const counts = countFamilies(lookups.map((result) => (result.status === 'fulfilled' ? result.value : null)));
    let isPartial = lookups.some(({ status }) => status === 'rejected');

    const family = pickWeeklyFamily(counts, data.weekKey);
    let items: RecMedia[] = [];
    if (family) {
        const members = BAKA_FAMILIES.find(({ key }) => key === family.key)?.tags ?? [];
        const excluded = [...data.listedIds, ...data.familySeeds];
        const pages: BakaSeries[][] = [];
        const details = new Map<number, RecMedia | null>();
        let open = members.map(({ id }) => id);
        // Page the members until enough cards survive the hide rules (or 3 pages).
        for (let page = 1; page <= FAMILY_MAX_PAGES && open.length; page += 1) {
            const memberIds = open;
            // oxlint-disable-next-line no-await-in-loop
            const results = await Promise.allSettled(
                memberIds.map((id) =>
                    searchBakaSeries(
                        buildBakaSearch({
                            tagIds: [id],
                            excludeIds: [],
                            types: [],
                            sort: 'POPULARITY',
                            minScore: 0,
                            showAdult: false,
                            page,
                            limit: getSearchLimit(),
                        }),
                    ),
                ),
            );
            isPartial ||= results.some(({ status }) => status === 'rejected');
            open = memberIds.filter((_, index) => {
                const result = results[index];
                return result.status === 'fulfilled' && result.value.hasNextPage;
            });
            results.forEach((result) => result.status === 'fulfilled' && pages.push(result.value.series));

            const series = mergeFamilySeries(pages, excluded);
            const missing = series.flatMap(({ anilistId }) =>
                anilistId === null || details.has(anilistId) ? [] : [anilistId],
            );
            // oxlint-disable-next-line no-await-in-loop
            const loaded = await loadDetails(missing);
            loaded.details.forEach((media, id) => details.set(id, media));
            isPartial ||= loaded.isPartial;

            const cards = series.map((each) =>
                toBakaMedia(each, each.anilistId === null ? null : details.get(each.anilistId)),
            );
            items = rankFamilyRow(cards, data.tasteWeights);
            if (items.filter(isVisible).length >= FAMILY_ROW_MIN) {
                break;
            }
        }
        items = items.slice(0, FAMILY_ROW_STORED).map(compactMedia);
    }

    const row: FamilyRowData = { family, counts, items };
    const untilNextWeek = getWeekBounds(new Date(data.weekStart)).end.getTime() - now.getTime();
    TsujiCache.set(
        familyKeyOf(userName, data.weekKey),
        row,
        isPartial ? PARTIAL_TTL_MS : Math.max(MIN_TTL_MS, untilNextWeek),
    );
    return row;
};

/** Rows being built, by cache key: leaving For You and coming back joins the same build. */
const building = new Map<string, Promise<FamilyRowData>>();

/**
 * This week's family row (brief #14). Built once the week shows, never on its path, and not cancelled by leaving the
 * tab: the 60 strongest liked titles' MangaBaka families (one lookup each, 6 at a time, cached a month), this week's
 * family's member searches (all comic types, safe ratings; the Adult filter can't add what isn't fetched), paged
 * until 10+ cards pass `isVisible` (the tab's hide rules, read when each page is in) or 3 pages, AniList details for
 * the cards, ranked by Best match. Cached until next Monday: a revisit asks nothing.
 */
export const loadFamilyRow = ({
    userName,
    data,
    isVisible,
    now = new Date(),
}: {
    userName: string;
    data: FamilyInput;
    isVisible: (media: RecMedia) => boolean;
    now?: Date;
}): Promise<FamilyRowData> => {
    const key = familyKeyOf(userName, data.weekKey);
    const cached = TsujiCache.get<FamilyRowData>(key);
    if (cached) {
        return Promise.resolve(cached);
    }
    let row = building.get(key);
    if (!row) {
        row = build(userName, data, isVisible, now).finally(() => building.delete(key));
        building.set(key, row);
    }
    return row;
};
