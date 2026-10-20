/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecFilters, TagFilterState } from '@/features/tsuji/recs/filters.ts';
import type { BakaSelection } from '@/features/tsuji/tags/baka.ts';
import { getAniListNames } from '@/features/tsuji/tags/baka.ts';

export type DiscoverSort = 'BEST' | 'TRENDING' | 'SCORE' | 'POPULARITY' | 'NEWEST';

/** Landing (no tags/genres picked) opens on Trending; once tags are picked the default is Best match. */
export const LANDING_SORTS: DiscoverSort[] = ['TRENDING', 'SCORE', 'POPULARITY', 'NEWEST'];
export const BROWSE_SORTS: DiscoverSort[] = ['BEST', 'SCORE', 'POPULARITY', 'NEWEST'];

/** Best match is a client re-rank over the POPULARITY_DESC feed. */
export const SERVER_SORTS: Record<DiscoverSort, string> = {
    BEST: 'POPULARITY_DESC',
    TRENDING: 'TRENDING_DESC',
    SCORE: 'SCORE_DESC',
    POPULARITY: 'POPULARITY_DESC',
    NEWEST: 'START_DATE_DESC',
};

/**
 * AniList (degraded mode, 2026-09) intermittently returns zero results, or answers in ~10 s, for TRENDING_DESC and
 * START_DATE_DESC while other sorts work. See loadDiscoverPage for when the fallback is used and remembered.
 */
export const SORT_FALLBACKS: Partial<Record<string, string>> = {
    TRENDING_DESC: 'POPULARITY_DESC',
    START_DATE_DESC: 'ID_DESC',
};

export type DiscoverSelection = {
    genres: Record<string, TagFilterState>;
    tags: Record<string, TagFilterState>;
    /** Chips from the universal tag search with a MangaBaka tag behind them (brief #9), by tag key. */
    baka?: BakaSelection;
};

export const EMPTY_SELECTION: DiscoverSelection = { genres: {}, tags: {} };

const namesWithState = (states: Record<string, TagFilterState>, wanted: TagFilterState): string[] =>
    Object.entries(states)
        .filter(([, state]) => state === wanted)
        .map(([name]) => name)
        .sort();

export const hasSelection = ({ genres, tags, baka }: DiscoverSelection): boolean =>
    Object.keys(genres).length > 0 || Object.keys(tags).length > 0 || Object.keys(baka ?? {}).length > 0;

export const getIncludedTags = ({ tags, baka }: DiscoverSelection): string[] =>
    [...new Set([...namesWithState(tags, 'include'), ...getAniListNames(baka, 'include').tags])].sort();

const COUNTRY_BY_TYPE = { MANHWA: 'KR', MANGA: 'JP' } as const;

const nonEmpty = <T>(list: T[]): T[] | undefined => (list.length ? list : undefined);

export type DiscoverVariables = Record<string, unknown>;

const withMerged = (names: string[], merged: string[]) => [...new Set([...names, ...merged])].sort();

/**
 * AniList filter arguments. Status, score and a single country go server-side to save the 30 req/min budget. The rest
 * stays client-side: hide started, min chapters, multi-type, Manhua (CN + TW), and novels/one-shots + adult,
 * because `format_not_in` / `isAdult` made degraded AniList ~4x slower (1.6 s vs 0.37 s) and intermittently empty.
 * Empty lists are omitted because AniList treats an empty `_in` list as "match nothing".
 */
export const buildDiscoverVariables = (selection: DiscoverSelection, filters: RecFilters): DiscoverVariables => {
    const [onlyType] = filters.types;
    const country = filters.types.length === 1 && onlyType !== 'MANHUA' ? COUNTRY_BY_TYPE[onlyType] : undefined;

    // Merged chips (AniList + MangaBaka names) search AniList by their AniList name.
    const included = getAniListNames(selection.baka, 'include');
    const excluded = getAniListNames(selection.baka, 'exclude');
    const variables: DiscoverVariables = {
        genreIn: nonEmpty(withMerged(namesWithState(selection.genres, 'include'), included.genres)),
        genreNotIn: nonEmpty(withMerged(namesWithState(selection.genres, 'exclude'), excluded.genres)),
        tagIn: nonEmpty(withMerged(namesWithState(selection.tags, 'include'), included.tags)),
        tagNotIn: nonEmpty(withMerged(namesWithState(selection.tags, 'exclude'), excluded.tags)),
        statusIn: nonEmpty([...filters.statuses].sort()),
        country,
        minScore: filters.minScore > 0 ? filters.minScore - 1 : undefined,
    };

    return Object.fromEntries(Object.entries(variables).filter(([, value]) => value !== undefined));
};

/** Server filters that the client filters (passesFilters) also apply, so dropping them never shows wrong titles. */
const OPTIONAL_FILTER_KEYS = ['statusIn', 'country', 'minScore'];

export const hasOptionalFilters = (variables: DiscoverVariables): boolean =>
    Object.keys(variables).some((key) => OPTIONAL_FILTER_KEYS.includes(key));

/**
 * Whether a title satisfies the optional server filters (status, single country, minimum score). Used to tell
 * "AniList dropped results for these arguments" (relaxed results still match them) from a filter combination that
 * genuinely has no matches (relaxed results don't).
 */
export const matchesOptionalFilters = (
    media: { status: string | null; countryOfOrigin: string | null; averageScore: number | null },
    variables: DiscoverVariables,
): boolean => {
    const { statusIn, country, minScore } = variables as { statusIn?: string[]; country?: string; minScore?: number };

    return (
        (!statusIn || (!!media.status && statusIn.includes(media.status))) &&
        (!country || media.countryOfOrigin === country) &&
        (minScore === undefined || (media.averageScore ?? 0) > minScore)
    );
};

export const stripOptionalFilters = (variables: DiscoverVariables): DiscoverVariables =>
    Object.fromEntries(Object.entries(variables).filter(([key]) => !OPTIONAL_FILTER_KEYS.includes(key)));
