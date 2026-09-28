/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecCandidate, RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import type { ScoredCandidate } from '@/features/tsuji/recs/rank.ts';
import { rankCandidates } from '@/features/tsuji/recs/rank.ts';
import type { SeedCandidate } from '@/features/tsuji/forYou/tasteProfile.ts';
import { LAST_WEEK_DEMOTION } from '@/features/tsuji/forYou/weeklyRotation.ts';

export type ForYouCandidate = RecCandidate & {
    /** AniList recommendation rating per seed that recommends this title (seed media id -> rating). */
    seedRatings: Record<string, number>;
};

export type SeedRecommendations = {
    seed: SeedCandidate;
    recommendations: { rating: number | null; media: RecMedia | null }[];
};

/**
 * Merges the seeds' recommendation edges and the tag recall into one candidate per title. The edge signal is the
 * seeds' ratings summed, each scaled by how much the user liked that seed (strongest seed = 1), so a title two
 * liked seeds recommend beats one a single seed does. Titles on the list and the seeds are left out.
 */
export const mergeForYouCandidates = ({
    seeds,
    recall,
    excludeIds,
}: {
    seeds: SeedRecommendations[];
    recall: RecMedia[];
    excludeIds: Iterable<number>;
}): ForYouCandidate[] => {
    const excluded = new Set([...excludeIds, ...seeds.map(({ seed }) => seed.mediaId)]);
    const strongest = Math.max(0, ...seeds.map(({ seed }) => seed.weight)) || 1;
    const byId = new Map<number, ForYouCandidate>();

    const add = (media: RecMedia) => {
        const existing = byId.get(media.id);
        if (existing) {
            return existing;
        }
        const candidate: ForYouCandidate = { ...media, edgeRating: 0, sources: [], seedRatings: {} };
        byId.set(media.id, candidate);
        return candidate;
    };

    seeds.forEach(({ seed, recommendations }) =>
        recommendations.forEach(({ rating, media }) => {
            if (!media || excluded.has(media.id)) {
                return;
            }
            const candidate = add(media);
            const clamped = Math.max(0, rating ?? 0);
            candidate.edgeRating += clamped * (seed.weight / strongest);
            candidate.seedRatings[String(seed.mediaId)] = clamped;
            if (!candidate.sources.includes('anilist')) {
                candidate.sources.push('anilist');
            }
        }),
    );

    recall.forEach((media) => {
        if (excluded.has(media.id)) {
            return;
        }
        const candidate = add(media);
        if (!candidate.sources.includes('tags')) {
            candidate.sources.push('tags');
        }
    });

    return [...byId.values()];
};

/**
 * Makimono's ranker with the taste profile as the "seed" tags, then last week's top picks moved down a little so
 * a new week opens with new titles.
 */
export const rankForYou = (
    profileTags: RecTag[],
    candidates: ForYouCandidate[],
    lastWeekIds: Iterable<number> = [],
): (ScoredCandidate & ForYouCandidate)[] => {
    const lastWeek = new Set(lastWeekIds);
    return (rankCandidates(profileTags, candidates) as (ScoredCandidate & ForYouCandidate)[]).map((item) =>
        lastWeek.has(item.id) ? { ...item, bestMatch: item.bestMatch * LAST_WEEK_DEMOTION } : item,
    );
};

/** A seed's own row: its recommendations by that seed's rating (ties: overall match). */
export const getSeedRow = <T extends ScoredCandidate & ForYouCandidate>(items: T[], seedId: number): T[] =>
    items
        .filter((item) => item.seedRatings[String(seedId)] !== undefined)
        .sort((a, b) => b.seedRatings[String(seedId)] - a.seedRatings[String(seedId)] || b.bestMatch - a.bestMatch);
