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

const DAY_MS = 24 * 60 * 60 * 1000;
const MONTH_MS = 30.44 * DAY_MS;
/** LATE: past 3x the usual gap between releases, and at least this long. */
const LATE_MIN_DAYS = 21;

/** `late`: an ongoing series past its usual release rhythm, under 3 months quiet (brief v6). */
export type FreshnessKind = 'late' | '3mo' | '6mo' | '1yr';
export type Freshness = { kind: FreshnessKind; sinceDays: number; gapDays: number | null } | null;

/** Statuses the freshness tag is for: still coming out (or paused). */
export const isOngoingStatus = (status: string | null | undefined) => status === 'RELEASING' || status === 'HIATUS';

/** The relay's release timing for a library series (v6 index: `lr`, `gm`). */
export type ReleaseTiming = { lastRelease: number | null; gapDays: number | null };

/**
 * "> 1 YR" from 12 months since the latest chapter, "> 6 MO" from 6, "> 3 MO" from 3 (Comick's date, else the relay's
 * last English release); under 3 months, "LATE" when the relay's last English release is past max(3x the usual gap,
 * 21 days). Nothing when fresher or unknown.
 */
export const getFreshness = (
    lastChapterAt: number | null | undefined,
    now: number = Date.now(),
    release: ReleaseTiming | null = null,
): Freshness => {
    const date = lastChapterAt || release?.lastRelease || null;
    const gapDays = release?.gapDays ?? null;
    if (date) {
        const months = (now - date) / MONTH_MS;
        const sinceDays = Math.floor((now - date) / DAY_MS);
        if (months >= 12) {
            return { kind: '1yr', sinceDays, gapDays };
        }
        if (months >= 6) {
            return { kind: '6mo', sinceDays, gapDays };
        }
        if (months >= 3) {
            return { kind: '3mo', sinceDays, gapDays };
        }
    }
    if (release?.lastRelease && gapDays) {
        const since = now - release.lastRelease;
        if (since < 3 * MONTH_MS && since > Math.max(3 * gapDays, LATE_MIN_DAYS) * DAY_MS) {
            return { kind: 'late', sinceDays: Math.floor(since / DAY_MS), gapDays };
        }
    }
    return null;
};
