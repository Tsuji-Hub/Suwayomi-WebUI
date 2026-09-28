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
import type { ForYouCandidate, SeedRecommendations } from '@/features/tsuji/forYou/forYouCandidates.ts';
import { mergeForYouCandidates, rankForYou } from '@/features/tsuji/forYou/forYouCandidates.ts';
import type { RecallResponse, SeedsResponse, TasteListResponse } from '@/features/tsuji/forYou/forYouQueries.ts';
import {
    buildSeedsQuery,
    parseTasteList,
    TASTE_LIST_QUERY,
    TASTE_RECALL_QUERY,
} from '@/features/tsuji/forYou/forYouQueries.ts';
import type { TasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';
import { buildTasteProfile } from '@/features/tsuji/forYou/tasteProfile.ts';
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
const MAX_CACHED_CANDIDATES = 150;
const MAX_CACHED_DESCRIPTION = 300;
const MAX_CACHED_TAGS = 12;

export type ForYouData = {
    weekKey: string;
    /** Local midnight of the week's Monday (ms). */
    weekStart: number;
    seeds: { mediaId: number; title: string }[];
    /** Strongest liked tags (for the "your taste" chips) and this week's recall tags. */
    profileTags: RecTag[];
    weekTags: { core: string[]; rotating: string[] };
    entryCount: number;
    candidates: ForYouCandidate[];
    isPartial: boolean;
};

export type ForYouResult = { kind: 'ready'; data: ForYouData } | { kind: 'empty'; entryCount: number };

const profileKey = (userName: string) => `foryou:taste:v1:${userName.toLowerCase()}`;
const weekKeyOf = (userName: string, weekKey: string) => `foryou:week:v1:${userName.toLowerCase()}:${weekKey}`;

const trimForCache = (media: ForYouCandidate): ForYouCandidate => ({
    ...media,
    description: media.description?.slice(0, MAX_CACHED_DESCRIPTION) ?? null,
    tags: [...(media.tags ?? [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, MAX_CACHED_TAGS),
});

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
    return profile;
};

/**
 * This week's For You for the AniList user: taste profile (cached a day) -> this week's seeds and tags (seeded by
 * user + ISO week) -> 2 AniList requests (all seeds' recommendations, taste recall) -> merged candidates, cached
 * until next Monday. Ranking and filters run at render (they depend on this browser's history and settings).
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
        const cached = TsujiCache.get<ForYouData>(cacheKey);
        if (cached) {
            return { kind: 'ready', data: cached };
        }
    }

    const profile = await loadProfile(userName, force, signal);
    if (!profile.seedPool.length || !profile.tags.length) {
        return { kind: 'empty', entryCount: profile.entryCount };
    }

    const random = createWeeklyRandom(userName, weekKey);
    const seeds = pickWeeklySeeds(profile.seedPool, random);
    const weekTags = pickWeeklyTags(profile.tags, random);

    const [seedsResult, recallResult] = await Promise.allSettled([
        loadSeedEdges(
            seeds.map(({ mediaId }) => mediaId),
            signal,
        ),
        aniList.request<RecallResponse>(
            TASTE_RECALL_QUERY,
            { core: weekTags.core, rotating: weekTags.rotating, withRotating: weekTags.rotating.length > 0 },
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        ),
    ]);
    signal.throwIfAborted();

    if (seedsResult.status === 'rejected' && recallResult.status === 'rejected') {
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
    // Keep the strongest by this week's ranking (without history) so the cache stays small.
    const kept = new Set(
        rankForYou(profile.tags, merged)
            .sort((a, b) => b.bestMatch - a.bestMatch)
            .slice(0, MAX_CACHED_CANDIDATES)
            .map(({ id }) => id),
    );

    const isPartial = seedsResult.status === 'rejected' || recallResult.status === 'rejected';
    const data: ForYouData = {
        weekKey,
        weekStart: start.getTime(),
        seeds: seeds.map(({ mediaId, title }) => ({ mediaId, title })),
        profileTags: profile.tags,
        weekTags,
        entryCount: profile.entryCount,
        candidates: merged.filter(({ id }) => kept.has(id)).map(trimForCache),
        isPartial,
    };

    const untilNextWeek = Math.max(MIN_WEEK_TTL_MS, end.getTime() - now.getTime());
    TsujiCache.set(cacheKey, data, isPartial ? PARTIAL_TTL_MS : untilNextWeek);

    return { kind: 'ready', data };
};
