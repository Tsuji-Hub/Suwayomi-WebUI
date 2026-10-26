/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';

/*
 * One "Top rated" order for every card source (brief #21): a card with an AniList id is scored by AniList's
 * averageScore (fetched for Comick cards in one batched request); a Comick-only card keeps Comick's bayesian rating x
 * 10 and says so ("CK"). Ties: popularity (AniList users, Comick follows); unknown scores last. And the freshness tag:
 * how long ago an ongoing series' latest chapter came out.
 */

export type AniListScore = { averageScore: number | null; meanScore: number | null; popularity: number | null };

/** The score on the card is Comick's (Comick-only, or AniList's not in yet). Older stored Comick cards carry no flag. */
export const isComickScored = (media: Pick<RecMedia, 'via' | 'scoreSource'>): boolean =>
    media.via === 'comick' && media.scoreSource !== null;

/**
 * Comick cards with an AniList id get AniList's score and popularity (the card then shows those); without an AniList
 * score they keep Comick's ("CK").
 */
export const applyAniListScores = <T extends RecMedia>(items: T[], scores: Map<number, AniListScore>): T[] =>
    items.map((item) => {
        const score = item.via === 'comick' && item.id > 0 ? scores.get(item.id) : undefined;
        const aniListScore = score ? (score.averageScore ?? score.meanScore) : null;
        return score && aniListScore !== null
            ? {
                  ...item,
                  averageScore: aniListScore,
                  popularity: score.popularity ?? item.popularity,
                  scoreSource: null,
              }
            : item;
    });

/** One list, highest score first, ties by popularity, unknown scores last (the order is otherwise kept). */
export const sortByMergedScore = <T extends Pick<RecMedia, 'averageScore' | 'popularity'>>(items: T[]): T[] =>
    items
        .map((item, position) => ({ item, position }))
        .sort(
            (a, b) =>
                (b.item.averageScore ?? -1) - (a.item.averageScore ?? -1) ||
                (b.item.popularity ?? 0) - (a.item.popularity ?? 0) ||
                a.position - b.position,
        )
        .map(({ item }) => item);

const MONTH_MS = 30.44 * 24 * 60 * 60 * 1000;

export type Freshness = '6mo' | '1yr' | null;

/** Statuses the freshness tag is for: still coming out (or paused). */
export const isOngoingStatus = (status: string | null | undefined) => status === 'RELEASING' || status === 'HIATUS';

/** "> 6 MO" for a latest chapter 6-12 months old, "> 1 YR" from 12 months; nothing when fresher or unknown. */
export const getFreshness = (lastChapterAt: number | null | undefined, now: number = Date.now()): Freshness => {
    if (!lastChapterAt) {
        return null;
    }
    const months = (now - lastChapterAt) / MONTH_MS;
    if (months >= 12) {
        return '1yr';
    }
    return months >= 6 ? '6mo' : null;
};
