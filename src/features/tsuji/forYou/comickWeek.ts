/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { ComickRecommendation } from '@/features/tsuji/comick/comickCatalog.ts';
import { loadComickRecommendations } from '@/features/tsuji/comick/ComickService.ts';
import { adoptListIds } from '@/features/tsuji/comick/listMatch.ts';
import type { ListTitleIndex } from '@/features/tsuji/seen/myList.ts';
import { readListTitleIndex } from '@/features/tsuji/seen/listTitles.ts';
import type { BestMatch, SeedRecommendations } from '@/features/tsuji/forYou/forYouCandidates.ts';
import { mergeBestMatches } from '@/features/tsuji/forYou/forYouCandidates.ts';
import type { ForYouData, ForYouResult } from '@/features/tsuji/forYou/ForYouService.ts';
import type { SeedCandidate } from '@/features/tsuji/forYou/tasteProfile.ts';
import { getBaseline, getDistinctiveTags, toProfileTags, toTasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { readLastProfile } from '@/features/tsuji/forYou/tasteStore.ts';
import { getIsoWeekKey, getWeekBounds } from '@/features/tsuji/forYou/weeklyRotation.ts';
import type { StoredWeek } from '@/features/tsuji/forYou/weekStore.ts';
import { fromStoredWeek, toStoredWeek } from '@/features/tsuji/forYou/weekStore.ts';

/*
 * For You while AniList is down (brief #15): the last profile AniList gave (kept a month) and Comick's
 * recommendations for its strongest liked titles, scored as Best matches are (votes x how much the title was
 * liked). Cards take the AniList id of the list title they match, so list, library and read marks still hide them.
 * Kept an hour: For You is back on AniList soon after AniList is.
 */

const FALLBACK_TTL_MS = 60 * 60 * 1000;
/** Liked titles asked about (Comick allows 200 requests a minute; resolved slugs are kept a month). */
export const COMICK_SEED_COUNT = 40;
const MAX_BEST = 120;

const fallbackKey = (userName: string, weekKey: string) => `foryou:comick:v1:${userName.toLowerCase()}:${weekKey}`;

/** Comick's recommendations per liked title as Best matches: the list and the seeds left out, Comick as source. */
export const mergeComickBestMatches = ({
    seeds,
    recommendations,
    listedIds,
    index,
}: {
    seeds: SeedCandidate[];
    recommendations: (ComickRecommendation[] | null)[];
    listedIds: number[];
    index: ListTitleIndex | null;
}): BestMatch[] => {
    const edges: SeedRecommendations[] = seeds.map((seed, seedIndex) => {
        const list = recommendations[seedIndex] ?? [];
        const cards = adoptListIds(
            list.map(({ media }) => media),
            index,
        );
        return { seed, recommendations: cards.map((media, at) => ({ rating: list[at].votes, media })) };
    });
    return mergeBestMatches({ seeds: edges, excludeIds: listedIds }).map((match) => ({
        ...match,
        sources: ['comick'],
    }));
};

export const loadComickWeek = async ({
    userName,
    now,
    signal,
}: {
    userName: string;
    now: Date;
    signal: AbortSignal;
}): Promise<ForYouResult> => {
    const weekKey = getIsoWeekKey(now);
    const cacheKey = fallbackKey(userName, weekKey);
    const cached = TsujiCache.get<StoredWeek>(cacheKey);
    if (cached) {
        return { kind: 'ready', data: fromStoredWeek(cached) };
    }

    const last = readLastProfile(userName);
    if (!last) {
        throw new Error('AniList is down and no list of yours is known yet');
    }
    const { profile, fetchedAt } = last;
    const seeds = profile.bestSeeds.slice(0, COMICK_SEED_COUNT);
    const results = await Promise.allSettled(
        seeds.map((seed) => loadComickRecommendations(seed.mediaId, [seed.title], signal)),
    );
    signal.throwIfAborted();
    if (seeds.length && results.every(({ status }) => status === 'rejected')) {
        throw (results[0] as PromiseRejectedResult).reason;
    }

    const distinctive = getDistinctiveTags(profile.tagStats, profile.likedCount, getBaseline());
    const data: ForYouData = {
        weekKey,
        weekStart: getWeekBounds(now).start.getTime(),
        seeds: [],
        profileTags: toProfileTags(distinctive),
        tasteWeights: toTasteWeights(distinctive),
        weekTags: { core: [], rotating: [] },
        entryCount: profile.entryCount,
        candidates: [],
        bestSeeds: profile.bestSeeds,
        bestMatches: mergeComickBestMatches({
            seeds,
            recommendations: results.map((result) => (result.status === 'fulfilled' ? result.value : null)),
            listedIds: profile.listedIds,
            index: readListTitleIndex(userName),
        }).slice(0, MAX_BEST),
        familySeeds: profile.familySeeds,
        listedIds: profile.listedIds,
        isPartial: results.some(({ status }) => status === 'rejected'),
        fallback: { listFetchedAt: fetchedAt },
    };
    const stored = toStoredWeek(data);
    TsujiCache.set(cacheKey, stored, FALLBACK_TTL_MS);
    return { kind: 'ready', data: fromStoredWeek(stored) };
};
