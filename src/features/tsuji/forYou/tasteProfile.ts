/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import { getContentTags } from '@/features/tsuji/recs/media.ts';
import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';

/*
 * Taste profile from the user's AniList manga list: which content tags the titles they liked carry, and which of
 * those titles can seed this week's recommendations. The weights below are Tsuji's (Makimono has no For You
 * ranker to port); the recommendation ranking itself reuses Makimono's constants (rank.ts).
 */

export type TasteStatus = 'CURRENT' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';

export type TasteEntry = {
    mediaId: number;
    status: TasteStatus;
    progress: number;
    /** 0-100, 0 = not scored. */
    score: number;
    /** Unix seconds of the last list update, 0 if unknown. */
    updatedAt: number;
    title: string;
    tags: RecTag[];
};

/** How much a list status says "I like this". Dropped counts against its tags. */
export const STATUS_WEIGHT: Record<TasteStatus, number> = {
    REPEATING: 1.2,
    COMPLETED: 1,
    CURRENT: 0.8,
    PAUSED: 0.3,
    DROPPED: -0.6,
};

/** Chapters read after which an ongoing title counts fully (fewer = still sampling it). */
export const PROGRESS_FULL_CHAPTERS = 20;

/** Scores (0-100) around which the score factor turns: 80 = 1, 50 = 0, 95 = 1.5, 35 = -0.5. */
const SCORE_NEUTRAL = 50;
const SCORE_SPAN = 30;
const SCORE_FACTOR_MAX = 1.5;

/** Recency: an entry last updated this long ago counts 75 %, and never less than half. */
export const RECENCY_HALF_LIFE_DAYS = 180;

/** Tags kept in the profile and titles kept as possible seeds. */
export const PROFILE_TAG_COUNT = 30;
export const SEED_POOL_SIZE = 30;

const progressFactor = ({ status, progress }: Pick<TasteEntry, 'status' | 'progress'>) =>
    status === 'CURRENT' || status === 'PAUSED' ? 0.4 + 0.6 * Math.min(1, progress / PROGRESS_FULL_CHAPTERS) : 1;

const scoreFactor = (score: number) =>
    score > 0 ? Math.max(-1, Math.min(SCORE_FACTOR_MAX, (score - SCORE_NEUTRAL) / SCORE_SPAN)) : 1;

const recencyFactor = (updatedAt: number, now: number) => {
    if (updatedAt <= 0) {
        return 0.5;
    }
    const ageDays = Math.max(0, now - updatedAt * 1000) / DAY_MS;
    return 0.5 + 0.5 * 2 ** (-ageDays / RECENCY_HALF_LIFE_DAYS);
};

/** Signed weight of one list entry: status x progress x score x recency. */
export const getEntryWeight = (entry: TasteEntry, now: number): number => {
    const statusWeight = STATUS_WEIGHT[entry.status];
    const recency = recencyFactor(entry.updatedAt, now);

    // A dropped title is a "no" whatever its score says.
    if (statusWeight < 0) {
        return statusWeight * recency;
    }

    return statusWeight * progressFactor(entry) * scoreFactor(entry.score) * recency;
};

export type SeedCandidate = { mediaId: number; title: string; weight: number };

export type TasteProfile = {
    /** Strongest liked content tags, rank = 0-100 relative to the strongest (the ranker's seed-tag shape). */
    tags: RecTag[];
    /** Liked titles, strongest first: this week's seeds are drawn from them. */
    seedPool: SeedCandidate[];
    /** Every title on the list (any status in the profile query): never recommended back. */
    listedIds: number[];
    entryCount: number;
};

export const buildTasteProfile = (entries: TasteEntry[], now: number): TasteProfile => {
    const tagTotals = new Map<string, number>();
    const weighted = entries.map((entry) => ({ entry, weight: getEntryWeight(entry, now) }));

    weighted.forEach(({ entry, weight }) =>
        getContentTags(entry).forEach((tag) => {
            const rank = Math.max(0, tag.rank ?? 0) / 100;
            tagTotals.set(tag.name, (tagTotals.get(tag.name) ?? 0) + weight * rank);
        }),
    );

    const liked = [...tagTotals.entries()]
        .filter(([, total]) => total > 0)
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, PROFILE_TAG_COUNT);
    const strongest = liked[0]?.[1] ?? 1;

    return {
        tags: liked.map(([name, total]) => ({ name, rank: Math.max(1, Math.round((100 * total) / strongest)) })),
        seedPool: weighted
            .filter(({ weight }) => weight > 0)
            .sort((a, b) => b.weight - a.weight || a.entry.mediaId - b.entry.mediaId)
            .slice(0, SEED_POOL_SIZE)
            .map(({ entry, weight }) => ({ mediaId: entry.mediaId, title: entry.title, weight })),
        listedIds: entries.map(({ mediaId }) => mediaId),
        entryCount: entries.length,
    };
};
