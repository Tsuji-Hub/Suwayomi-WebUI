/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { BakaSeries } from '@/features/tsuji/tags/baka.ts';
import { BAKA_FAMILIES } from '@/features/tsuji/tags/baka.ts';
import type { TasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { rankBestMatch } from '@/features/tsuji/recs/bestMatch.ts';

/*
 * The weekly family row (brief #14): AniList has no "System" or "Regression" tag, MangaBaka does. The strongest
 * liked titles are looked up on MangaBaka; a family 5+ of them carry earns a "More <Family>" row from MangaBaka,
 * ordered by Best match (every card matches the family, so by taste), one family a week, taking turns.
 */

/** Liked titles (of the 60 looked up) that must carry a family for it to earn a row. */
export const FAMILY_MIN_TITLES = 5;
/** Cards the row should show: the family's searches page on until this many pass the hide rules. */
export const FAMILY_ROW_MIN = 10;
/** Pages per member search at most. */
export const FAMILY_MAX_PAGES = 3;
/** Cards kept for the row (filters run at render). */
export const FAMILY_ROW_STORED = 60;

export type FamilyRef = { key: string; label: string };

/** How many of the looked-up titles carry each family (a failed lookup counts for nothing). */
export const countFamilies = (memberships: (string[] | null)[]): Record<string, number> => {
    const counts: Record<string, number> = {};
    memberships.forEach((families) =>
        families?.forEach((key) => {
            counts[key] = (counts[key] ?? 0) + 1;
        }),
    );
    return counts;
};

/** Families with enough liked titles, in BAKA_FAMILIES order. */
export const getQualifyingFamilies = (counts: Record<string, number>): FamilyRef[] =>
    BAKA_FAMILIES.filter(({ key }) => (counts[key] ?? 0) >= FAMILY_MIN_TITLES).map(({ key, label }) => ({
        key,
        label,
    }));

/** "2026-W43" -> a running week number, so consecutive weeks take consecutive turns. */
const weekOrdinal = (weekKey: string): number => {
    const [, year, week] = /^(\d+)-W(\d+)$/.exec(weekKey) ?? [];
    return Number(year ?? 0) * 53 + Number(week ?? 0);
};

/** This week's family: the qualifying ones take turns week by week; null when none qualifies. */
export const pickWeeklyFamily = (counts: Record<string, number>, weekKey: string): FamilyRef | null => {
    const qualifying = getQualifyingFamilies(counts);
    return qualifying.length ? qualifying[weekOrdinal(weekKey) % qualifying.length] : null;
};

/** The family's sub-search pages merged by MangaBaka popularity, each series once, without the excluded ids. */
export const mergeFamilySeries = (pages: BakaSeries[][], excludeAniListIds: Iterable<number>): BakaSeries[] => {
    const excluded = new Set(excludeAniListIds);
    const byId = new Map<number, BakaSeries>();
    pages.flat().forEach((series) => {
        if (!byId.has(series.id) && (series.anilistId === null || !excluded.has(series.anilistId))) {
            byId.set(series.id, series);
        }
    });
    return [...byId.values()].sort(
        (a, b) =>
            (a.popularity ?? Number.POSITIVE_INFINITY) - (b.popularity ?? Number.POSITIVE_INFINITY) || a.id - b.id,
    );
};

/** Best match within the family: every card matches it, so the taste decides (ties: MangaBaka popularity). */
export const rankFamilyRow = <T extends Pick<RecMedia, 'tags' | 'genres' | 'popularity'>>(
    cards: T[],
    weights: TasteWeights | null,
): T[] => rankBestMatch(cards, { matched: 1, tags: [], genres: [] }, weights, 'order');
