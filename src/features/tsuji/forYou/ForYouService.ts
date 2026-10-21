/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import type { SeedResponse } from '@/features/tsuji/recs/aniListQueries.ts';
import { SEED_QUERY } from '@/features/tsuji/recs/aniListQueries.ts';
import { aniList, ANILIST_TIMEOUT_MS, isAniListTimeout } from '@/features/tsuji/services/AniListClient.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { BestMatch, ForYouCandidate, SeedRecommendations } from '@/features/tsuji/forYou/forYouCandidates.ts';
import { mergeBestMatches, mergeForYouCandidates, rankForYou } from '@/features/tsuji/forYou/forYouCandidates.ts';
import type { RecallResponse, SeedsResponse, TasteListResponse } from '@/features/tsuji/forYou/forYouQueries.ts';
import {
    BEST_BATCH_SIZE,
    BEST_EDGES_PER_SEED,
    buildSeedsQuery,
    parseTasteList,
    TASTE_LIST_QUERY,
    TASTE_RECALL_QUERY,
} from '@/features/tsuji/forYou/forYouQueries.ts';
import type { SeedCandidate, TasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';
import type { StoredWeek } from '@/features/tsuji/forYou/weekStore.ts';
import { fromStoredWeek, toStoredWeek } from '@/features/tsuji/forYou/weekStore.ts';
import { buildTasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';
import type { TasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { getBaseline, getDistinctiveTags, toProfileTags, toTasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { readTasteWeights, writeLastProfile, writeTasteWeights } from '@/features/tsuji/forYou/tasteStore.ts';
import { AniListHealth } from '@/features/tsuji/services/aniListHealth.ts';
import { loadComickWeek } from '@/features/tsuji/forYou/comickWeek.ts';
import {
    createWeeklyRandom,
    getIsoWeekKey,
    getWeekBounds,
    pickWeeklySeeds,
    pickWeeklyTags,
} from '@/features/tsuji/forYou/weeklyRotation.ts';

const PROFILE_TTL_MS = DAY_MS;
/** A week missing its seeds or recall is only cached briefly, so the next visit retries. */
const PARTIAL_TTL_MS = 60 * 60 * 1000;
const MIN_WEEK_TTL_MS = 60 * 60 * 1000;
/** Candidates kept per week (strongest first); filters run at render, so keep room for hidden ones. */
const MAX_CACHED_CANDIDATES = 120;
/** Best matches kept per week (30 are shown; filters run at render). */
const MAX_CACHED_BEST = 120;

export type ForYouData = {
    weekKey: string;
    /** Local midnight of the week's Monday (ms). */
    weekStart: number;
    seeds: { mediaId: number; title: string }[];
    /** Strongest distinctive liked tags (the "your taste" chips, the ranking) and this week's recall tags. */
    profileTags: RecTag[];
    /** The same tags as weights (strongest = 1): the family row's Best match order. */
    tasteWeights: TasteWeights;
    weekTags: { core: string[]; rotating: string[] };
    entryCount: number;
    candidates: ForYouCandidate[];
    /** The strongest liked titles and their recommendations, strongest first (brief #13). */
    bestSeeds: SeedCandidate[];
    bestMatches: BestMatch[];
    /** The strongest liked titles looked up on MangaBaka for the family row (brief #14). */
    familySeeds: number[];
    /** Every title on the list: never recommended back (the family row is built after the week). */
    listedIds: number[];
    isPartial: boolean;
    /** Built from Comick while AniList is down (brief #15), on the list as it was then. */
    fallback?: { listFetchedAt: number } | null;
};

export type ForYouResult = { kind: 'ready'; data: ForYouData } | { kind: 'empty'; entryCount: number };

// v3 (brief #14): the profile has tag counts (the lift) and family seeds.
const profileKey = (userName: string) => `foryou:taste:v3:${userName.toLowerCase()}`;

// v5 (brief #14 fix): distinctive tags against the snapshot. v4: the family row's inputs. v3: stored compact.
const weekKeyOf = (userName: string, weekKey: string) => `foryou:week:v5:${userName.toLowerCase()}:${weekKey}`;

type SeedEdgeList = { rating: number | null; media: RecMedia | null }[];

/**
 * All seeds' recommendations in one aliased request; if AniList rejects that one (e.g. its query complexity limit),
 * one request per seed with Similar's proven seed query. A timeout is not retried per seed (AniList is just slow).
 */
const loadSeedEdges = async (seedIds: number[], signal: AbortSignal): Promise<SeedEdgeList[]> => {
    try {
        const response = await aniList.request<SeedsResponse>(
            buildSeedsQuery(seedIds.length),
            Object.fromEntries(seedIds.map((id, index) => [`id${index}`, id])),
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        );
        return seedIds.map((_, index) =>
            (response[`s${index}`]?.recommendations?.nodes ?? []).map(({ rating, mediaRecommendation }) => ({
                rating,
                media: mediaRecommendation,
            })),
        );
    } catch (error) {
        if (signal.aborted || isAniListTimeout(error)) {
            throw error;
        }
        const results = await Promise.allSettled(
            seedIds.map((id) =>
                aniList.request<SeedResponse>(SEED_QUERY, { id }, { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow }),
            ),
        );
        if (results.every((result) => result.status === 'rejected')) {
            throw error;
        }
        return results.map((result) =>
            result.status === 'fulfilled'
                ? (result.value.Media?.recommendations?.nodes ?? []).map(({ rating, mediaRecommendation }) => ({
                      rating,
                      media: mediaRecommendation,
                  }))
                : [],
        );
    }
};

/**
 * "Best matches" edges: the strongest liked titles in aliased requests of 8 (10 recommendations each, 5 requests
 * for 40 seeds), through the shared AniList queue. A batch that fails is left out (the week is then partial).
 */
const loadBestEdges = async (
    seeds: SeedCandidate[],
    signal: AbortSignal,
): Promise<{ edges: SeedRecommendations[]; isPartial: boolean }> => {
    const batches = Array.from({ length: Math.ceil(seeds.length / BEST_BATCH_SIZE) }, (_, index) =>
        seeds.slice(index * BEST_BATCH_SIZE, (index + 1) * BEST_BATCH_SIZE),
    );
    const results = await Promise.allSettled(
        batches.map((batch) =>
            aniList.request<SeedsResponse>(
                buildSeedsQuery(batch.length, BEST_EDGES_PER_SEED, 'TsujiForYouBest'),
                Object.fromEntries(batch.map(({ mediaId }, index) => [`id${index}`, mediaId])),
                { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
            ),
        ),
    );
    signal.throwIfAborted();
    const edges = batches.flatMap((batch, batchIndex) => {
        const result = results[batchIndex];
        if (result.status === 'rejected') {
            return [];
        }
        return batch.map((seed, index) => ({
            seed,
            recommendations: (result.value[`s${index}`]?.recommendations?.nodes ?? []).map(
                ({ rating, mediaRecommendation }) => ({ rating, media: mediaRecommendation }),
            ),
        }));
    });
    return { edges, isPartial: results.some(({ status }) => status === 'rejected') };
};

const loadProfile = async (userName: string, force: boolean, signal: AbortSignal): Promise<TasteProfile> => {
    if (!force) {
        const cached = TsujiCache.get<TasteProfile>(profileKey(userName));
        if (cached) {
            return cached;
        }
    }

    const response = await aniList.request<TasteListResponse>(
        TASTE_LIST_QUERY,
        { userName },
        { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
    );
    const profile = buildTasteProfile(parseTasteList(response), Date.now());
    signal.throwIfAborted();
    TsujiCache.set(profileKey(userName), profile, PROFILE_TTL_MS);
    writeLastProfile(userName, profile);
    return profile;
};

/**
 * This week's For You for the AniList user: taste profile (cached a day) -> this week's seeds and tags (seeded by
 * user + ISO week) -> 2 AniList requests (all seeds' recommendations, taste recall) plus 5 for "Best matches" (the
 * 40 strongest liked titles, 8 a request) -> merged candidates, cached until next Monday. Ranking and filters run at render (they depend on this browser's history and settings).
 */
export const loadForYou = async ({
    userName,
    now = new Date(),
    force = false,
    signal,
}: {
    userName: string;
    now?: Date;
    force?: boolean;
    signal: AbortSignal;
}): Promise<ForYouResult> => {
    const weekKey = getIsoWeekKey(now);
    const { start, end } = getWeekBounds(now);
    const cacheKey = weekKeyOf(userName, weekKey);

    if (!force) {
        const cached = TsujiCache.get<StoredWeek>(cacheKey);
        if (cached) {
            // Discover's Best match reads the weights; put them back if the cache let them go.
            if (!readTasteWeights(userName) && cached.tasteWeights) {
                writeTasteWeights(userName, cached.tasteWeights);
            }
            return { kind: 'ready', data: fromStoredWeek(cached) };
        }
    }

    // AniList down (brief #15): picks from Comick on the last list AniList gave.
    const fromComick = () => loadComickWeek({ userName, now, signal });
    if (AniListHealth.isDown()) {
        return fromComick();
    }
    let profile: TasteProfile;
    try {
        profile = await loadProfile(userName, force, signal);
    } catch (error) {
        if (!signal.aborted && AniListHealth.isDown()) {
            return fromComick();
        }
        throw error;
    }
    if (!profile.seedPool.length || !profile.tags.length) {
        return { kind: 'empty', entryCount: profile.entryCount };
    }

    const random = createWeeklyRandom(userName, weekKey);
    const seeds = pickWeeklySeeds(profile.seedPool, random);
    // Distinctive tags (brief #14) drive the recall, the ranking, the chips and Discover's Best match.
    const distinctive = getDistinctiveTags(profile.tagStats, profile.likedCount, getBaseline());
    const profileTags = toProfileTags(distinctive);
    const tasteWeights = toTasteWeights(distinctive);
    writeTasteWeights(userName, tasteWeights);
    const weekTags = pickWeeklyTags(profileTags, random);

    const [seedsResult, recallResult, bestResult] = await Promise.allSettled([
        loadSeedEdges(
            seeds.map(({ mediaId }) => mediaId),
            signal,
        ),
        aniList.request<RecallResponse>(
            TASTE_RECALL_QUERY,
            { core: weekTags.core, rotating: weekTags.rotating, withRotating: weekTags.rotating.length > 0 },
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        ),
        loadBestEdges(profile.bestSeeds, signal),
    ]);
    signal.throwIfAborted();

    if (seedsResult.status === 'rejected' && recallResult.status === 'rejected') {
        if (AniListHealth.isDown()) {
            return fromComick();
        }
        throw seedsResult.reason;
    }

    const seedEdges: SeedRecommendations[] =
        seedsResult.status === 'fulfilled'
            ? seeds.map((seed, index) => ({ seed, recommendations: seedsResult.value[index] }))
            : [];
    const recall: RecMedia[] =
        recallResult.status === 'fulfilled'
            ? [...(recallResult.value.core?.media ?? []), ...(recallResult.value.rotating?.media ?? [])]
            : [];

    const merged = mergeForYouCandidates({ seeds: seedEdges, recall, excludeIds: profile.listedIds });
    const best = bestResult.status === 'fulfilled' ? bestResult.value : { edges: [], isPartial: true };
    const bestMatches = mergeBestMatches({ seeds: best.edges, excludeIds: profile.listedIds }).slice(
        0,
        MAX_CACHED_BEST,
    );

    // Keep the strongest by this week's ranking (without history) so the cache stays small.
    const kept = new Set(
        rankForYou(profileTags, merged)
            .sort((a, b) => b.bestMatch - a.bestMatch)
            .slice(0, MAX_CACHED_CANDIDATES)
            .map(({ id }) => id),
    );

    const isPartial = seedsResult.status === 'rejected' || recallResult.status === 'rejected' || best.isPartial;
    const data: ForYouData = {
        weekKey,
        weekStart: start.getTime(),
        seeds: seeds.map(({ mediaId, title }) => ({ mediaId, title })),
        profileTags,
        tasteWeights,
        weekTags,
        entryCount: profile.entryCount,
        candidates: merged.filter(({ id }) => kept.has(id)),
        bestSeeds: profile.bestSeeds,
        bestMatches,
        familySeeds: profile.familySeeds,
        listedIds: profile.listedIds,
        isPartial,
    };

    const untilNextWeek = Math.max(MIN_WEEK_TTL_MS, end.getTime() - now.getTime());
    const stored = toStoredWeek(data);
    TsujiCache.set(cacheKey, stored, isPartial ? PARTIAL_TTL_MS : untilNextWeek);

    // The same shape whether it comes from this request or the cache.
    return { kind: 'ready', data: fromStoredWeek(stored) };
};
