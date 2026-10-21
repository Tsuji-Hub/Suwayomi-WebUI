/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { ComickRecommendation } from '@/features/tsuji/comick/comickCatalog.ts';
import {
    loadComickRecommendations,
    loadComickRecommendationsByTitle,
    searchComick,
} from '@/features/tsuji/comick/ComickService.ts';
import { buildComickSearch } from '@/features/tsuji/comick/comickCatalog.ts';
import { adoptListIds } from '@/features/tsuji/comick/listMatch.ts';
import type { ListTitleIndex } from '@/features/tsuji/seen/myList.ts';
import { readListTitleIndex } from '@/features/tsuji/seen/listTitles.ts';
import type { BestMatch, SeedRecommendations } from '@/features/tsuji/forYou/forYouCandidates.ts';
import { mergeBestMatches } from '@/features/tsuji/forYou/forYouCandidates.ts';
import type { ForYouData, ForYouResult } from '@/features/tsuji/forYou/ForYouService.ts';
import type { SeedCandidate, TasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getBaseline, getDistinctiveTags, toProfileTags, toTasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { readLastProfile } from '@/features/tsuji/forYou/tasteStore.ts';
import { getIsoWeekKey, getWeekBounds } from '@/features/tsuji/forYou/weeklyRotation.ts';
import type { StoredWeek } from '@/features/tsuji/forYou/weekStore.ts';
import { fromStoredWeek, toStoredWeek } from '@/features/tsuji/forYou/weekStore.ts';

/*
 * For You while AniList is down (brief #15): the last profile AniList gave (kept a month) and Comick's
 * recommendations for its strongest liked titles, scored as Best matches are (votes x how much the title was
 * liked); without one, the library's most read titles, then Comick's trending list. Cards take the AniList id of the
 * list title they match, so list, library and read marks still hide them. Kept an hour: For You is back on AniList
 * soon after AniList is.
 */

const FALLBACK_TTL_MS = 60 * 60 * 1000;
/** Liked titles asked about (Comick allows 200 requests a minute; resolved slugs are kept a month). */
export const COMICK_SEED_COUNT = 40;
const MAX_BEST = 120;

// v2 (r3434 fix): the library and trending fallbacks.
const fallbackKey = (userName: string, weekKey: string) => `foryou:comick:v2:${userName.toLowerCase()}:${weekKey}`;

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

/** A library title as For You's fallback sees it (brief #15 fix: no list known at all). */
export type LibraryEntry = { title: string; anilistId: number | null; readCount: number };

/**
 * Seeds from the Suwayomi library when no list is known (like Makimono's library path): the started titles, most
 * read first, weighted by how much was read. Titles without an AniList id get a negative one (only their title is
 * known).
 */
export const toLibrarySeeds = (entries: LibraryEntry[]): (SeedCandidate & { isTitleOnly: boolean })[] =>
    entries
        .filter(({ readCount, title }) => readCount > 0 && !!title)
        .sort((a, b) => b.readCount - a.readCount || a.title.localeCompare(b.title))
        .slice(0, COMICK_SEED_COUNT)
        .map(({ title, anilistId, readCount }, index) => ({
            mediaId: anilistId ?? -(index + 1),
            title,
            weight: Math.log2(1 + readCount),
            isTitleOnly: anilistId === null,
        }));

/** The trending list as picks: Comick's order is the score. */
export const toTrendingMatches = (cards: RecMedia[]): BestMatch[] =>
    cards.map((media, index) => ({
        ...media,
        edgeRating: 0,
        sources: ['comick'],
        seedRatings: {},
        bestScore: cards.length - index,
    }));

const TRENDING_QUERY = buildComickSearch({
    sort: 'TRENDING',
    types: [],
    statuses: [],
    minChapters: 0,
    page: 1,
    limit: 100,
});

/**
 * For You while AniList is down, whatever is known: the last list (its profile) -> Comick's recommendations of its
 * strongest titles; else the library's most read titles -> theirs; else Comick's trending titles. Each with its
 * own note; never the error screen while Comick answers.
 */
export const loadComickWeek = async ({
    userName,
    now,
    signal,
    cachedProfile = null,
    loadLibrary,
}: {
    userName: string;
    now: Date;
    signal: AbortSignal;
    /** The day-long profile cache, when the month-long copy isn't there yet. */
    cachedProfile?: TasteProfile | null;
    loadLibrary?: () => Promise<LibraryEntry[]>;
}): Promise<ForYouResult> => {
    const weekKey = getIsoWeekKey(now);
    const cacheKey = fallbackKey(userName, weekKey);
    const cached = TsujiCache.get<StoredWeek>(cacheKey);
    if (cached) {
        return { kind: 'ready', data: fromStoredWeek(cached) };
    }

    const index = readListTitleIndex(userName);
    const last =
        readLastProfile(userName) ?? (cachedProfile ? { profile: cachedProfile, fetchedAt: now.getTime() } : null);
    const base = {
        weekKey,
        weekStart: getWeekBounds(now).start.getTime(),
        seeds: [],
        weekTags: { core: [], rotating: [] },
        candidates: [],
        familySeeds: [] as number[],
        listedIds: [] as number[],
        profileTags: [] as ForYouData['profileTags'],
        tasteWeights: {},
        entryCount: 0,
    };
    const askComick = (seeds: (SeedCandidate & { isTitleOnly?: boolean })[]) =>
        Promise.allSettled(
            seeds.map((seed) =>
                seed.isTitleOnly
                    ? loadComickRecommendationsByTitle(seed.title, signal)
                    : loadComickRecommendations(seed.mediaId, [seed.title], signal),
            ),
        );

    let data: ForYouData | null = null;
    if (last) {
        const { profile, fetchedAt } = last;
        const seeds = profile.bestSeeds.slice(0, COMICK_SEED_COUNT);
        const results = await askComick(seeds);
        signal.throwIfAborted();
        const distinctive = getDistinctiveTags(profile.tagStats, profile.likedCount, getBaseline());
        const bestMatches = mergeComickBestMatches({
            seeds,
            recommendations: results.map((result) => (result.status === 'fulfilled' ? result.value : null)),
            listedIds: profile.listedIds,
            index,
        }).slice(0, MAX_BEST);
        if (bestMatches.length) {
            data = {
                ...base,
                profileTags: toProfileTags(distinctive),
                tasteWeights: toTasteWeights(distinctive),
                entryCount: profile.entryCount,
                bestSeeds: profile.bestSeeds,
                bestMatches,
                familySeeds: profile.familySeeds,
                listedIds: profile.listedIds,
                isPartial: results.some(({ status }) => status === 'rejected'),
                fallback: { kind: 'list', listFetchedAt: fetchedAt },
            };
        }
    }

    if (!data && loadLibrary) {
        const seeds = toLibrarySeeds(await loadLibrary().catch(() => []));
        const results = await askComick(seeds);
        signal.throwIfAborted();
        const bestMatches = mergeComickBestMatches({
            seeds,
            recommendations: results.map((result) => (result.status === 'fulfilled' ? result.value : null)),
            listedIds: [],
            index,
        }).slice(0, MAX_BEST);
        if (bestMatches.length) {
            data = {
                ...base,
                entryCount: seeds.length,
                bestSeeds: seeds,
                bestMatches,
                isPartial: results.some(({ status }) => status === 'rejected'),
                fallback: { kind: 'library' },
            };
        }
    }

    // Nothing to go on, or Comick knew none of it: what Comick's readers read now.
    data ??= {
        ...base,
        bestSeeds: [],
        bestMatches: toTrendingMatches(adoptListIds(await searchComick(TRENDING_QUERY, signal), index)),
        isPartial: false,
        fallback: { kind: 'trending' },
    };

    const stored = toStoredWeek(data);
    TsujiCache.set(cacheKey, stored, FALLBACK_TTL_MS);
    return { kind: 'ready', data: fromStoredWeek(stored) };
};
