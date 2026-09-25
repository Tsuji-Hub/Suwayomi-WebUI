/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecCandidate, RecMedia, RecSourceId, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import { isSpoilerTag } from '@/features/tsuji/recs/media.ts';

/*
 * Port of Makimono's shipped RecommendationRanker (rank + rankMerged + diversify + includeTagScore).
 * Every signal is min-max normalized across the candidate set before blending.
 */

export const WEIGHT_EDGE = 0.5;
export const WEIGHT_SIMILARITY = 0.3;
export const WEIGHT_QUALITY = 0.2;

/** Bayesian quality: catalog-mean prior (AniList 0-100) and confidence floor in popularity units. */
export const CATALOG_MEAN = 65;
export const QUALITY_CONFIDENCE = 5000;

/** Cross-source agreement blend (how many recommenders back a title). */
export const WEIGHT_AGREEMENT = 0.45;
export const WEIGHT_BASE = 0.55;

/** Hidden gems: popularity penalty exponent, agreement lift, and a floor that drops one-vote noise. */
export const GEM_GAMMA = 2;
export const GEM_AGREEMENT_BONUS = 0.5;
export const GEM_MIN_POPULARITY = 50;

export const MMR_LAMBDA = 0.7;
export const MMR_TOP_N = 25;

/** Sources that count as a recommender for agreement; tag recall is filler, not an endorsement. */
const RECOMMENDER_SOURCES: RecSourceId[] = ['anilist', 'mal'];

export type TagVector = Map<string, number>;

export const minMaxNormalize = (values: number[]): number[] => {
    if (!values.length) {
        return [];
    }

    const min = Math.min(...values);
    const range = Math.max(...values) - min;

    return values.map((value) => (range === 0 ? 0.5 : (value - min) / range));
};

/** WR = v/(v+m)*R + m/(v+m)*C with R = averageScore, then meanScore, then C. */
export const bayesianQuality = (
    averageScore: number | null | undefined,
    meanScore: number | null | undefined,
    popularity: number | null | undefined,
): number => {
    const score = averageScore ?? meanScore ?? CATALOG_MEAN;
    const votes = Math.max(0, popularity ?? 0);

    return (
        (votes / (votes + QUALITY_CONFIDENCE)) * score +
        (QUALITY_CONFIDENCE / (votes + QUALITY_CONFIDENCE)) * CATALOG_MEAN
    );
};

export const toTagVector = (tags: RecTag[] | null | undefined): TagVector =>
    new Map(
        (tags ?? [])
            .filter((tag) => !isSpoilerTag(tag) && (tag.rank ?? 0) > 0)
            .map((tag) => [tag.name, (tag.rank ?? 0) / 100]),
    );

const magnitude = (vector: TagVector): number =>
    Math.sqrt([...vector.values()].reduce((sum, value) => sum + value * value, 0));

export const cosineSimilarity = (a: TagVector, b: TagVector): number => {
    const denominator = magnitude(a) * magnitude(b);
    if (denominator === 0) {
        return 0;
    }

    let dot = 0;
    a.forEach((value, key) => {
        dot += value * (b.get(key) ?? 0);
    });

    return dot / denominator;
};

export const hiddenGemScore = (qualityNorm: number, popularityNorm: number, agreementNorm: number): number =>
    qualityNorm * (1 - popularityNorm) ** GEM_GAMMA * (1 + GEM_AGREEMENT_BONUS * agreementNorm);

export type ScoredCandidate = RecCandidate & {
    vector: TagVector;
    bestMatch: number;
    gem: number;
    /** Recommended by both AniList and MAL; shown as "AniList + MAL" on the card. */
    agreement: boolean;
};

export const rankCandidates = (seedTags: RecTag[], candidates: RecCandidate[]): ScoredCandidate[] => {
    if (!candidates.length) {
        return [];
    }

    const seedVector = toTagVector(seedTags);
    const vectors = candidates.map((candidate) => toTagVector(candidate.tags));
    const recommenderCounts = candidates.map(
        (candidate) => candidate.sources.filter((source) => RECOMMENDER_SOURCES.includes(source)).length,
    );

    // AniList edge ratings can be negative (downvoted); clamp so a downvote can't drag the min-max floor.
    const edge = minMaxNormalize(candidates.map((candidate) => Math.max(0, candidate.edgeRating)));
    const similarity = minMaxNormalize(vectors.map((vector) => cosineSimilarity(seedVector, vector)));
    const quality = minMaxNormalize(
        candidates.map((candidate) =>
            bayesianQuality(candidate.averageScore, candidate.meanScore, candidate.popularity),
        ),
    );
    const popularity = minMaxNormalize(candidates.map((candidate) => candidate.popularity ?? 0));
    const agreement = minMaxNormalize(recommenderCounts);

    return candidates.map((candidate, index) => {
        const base =
            WEIGHT_EDGE * edge[index] + WEIGHT_SIMILARITY * similarity[index] + WEIGHT_QUALITY * quality[index];

        return {
            ...candidate,
            vector: vectors[index],
            bestMatch: WEIGHT_AGREEMENT * agreement[index] + WEIGHT_BASE * base,
            gem: hiddenGemScore(quality[index], popularity[index], agreement[index]),
            agreement: recommenderCounts[index] >= RECOMMENDER_SOURCES.length,
        };
    });
};

/**
 * Greedy maximal-marginal-relevance reorder of the top `windowSize` of an already relevance-sorted list, so the
 * head isn't near-identical titles. Items past the window keep their order. Ties go to the earlier item.
 */
export const diversify = <T extends { vector: TagVector }>(
    sorted: T[],
    relevance: (item: T) => number,
    lambda: number = MMR_LAMBDA,
    windowSize: number = MMR_TOP_N,
): T[] => {
    if (sorted.length <= 2) {
        return sorted;
    }

    const pool = sorted.slice(0, Math.min(sorted.length, windowSize));
    const tail = sorted.slice(pool.length);
    const selected = pool.splice(0, 1);

    while (pool.length) {
        let bestIndex = 0;
        let bestValue = -Infinity;

        for (let index = 0; index < pool.length; index += 1) {
            const candidate = pool[index];
            const maxSimilarity = Math.max(...selected.map((item) => cosineSimilarity(candidate.vector, item.vector)));
            const value = lambda * relevance(candidate) - (1 - lambda) * maxSimilarity;

            if (value > bestValue) {
                bestValue = value;
                bestIndex = index;
            }
        }

        selected.push(...pool.splice(bestIndex, 1));
    }

    return [...selected, ...tail];
};

/**
 * Discover "best match" in [0,1]: mean over the selected include tags of the candidate's rank/100 for that tag
 * (0 when absent), rewarding both how many chosen tags a title carries and how strongly. Spoilers ignored.
 */
export const includeTagScore = (includedTags: string[], candidateTags: RecTag[] | null | undefined): number => {
    if (!includedTags.length) {
        return 0;
    }

    const rankByName = new Map(
        (candidateTags ?? []).filter((tag) => !isSpoilerTag(tag)).map((tag) => [tag.name, tag.rank ?? 0]),
    );
    const total = includedTags.reduce((sum, name) => sum + Math.max(0, rankByName.get(name) ?? 0) / 100, 0);

    return total / includedTags.length;
};

/** Re-rank one fetched page by include-tag score (ties: popularity desc). Pages are appended, never reshuffled. */
export const rerankByIncludeTags = <T extends Pick<RecMedia, 'tags' | 'popularity'>>(
    page: T[],
    includedTags: string[],
): T[] =>
    page
        .map((media) => ({ media, score: includeTagScore(includedTags, media.tags) }))
        .sort((a, b) => b.score - a.score || (b.media.popularity ?? 0) - (a.media.popularity ?? 0))
        .map(({ media }) => media);
