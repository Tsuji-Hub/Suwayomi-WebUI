/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecFilters, TagFilterState } from '@/features/tsuji/recs/filters.ts';

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
 * AniList (degraded mode, 2026-09) returns zero results for TRENDING_DESC and START_DATE_DESC while other sorts
 * work. When page 1 of these comes back empty but the fallback doesn't, the fallback is used for the session.
 */
export const SORT_FALLBACKS: Partial<Record<string, string>> = {
    TRENDING_DESC: 'POPULARITY_DESC',
    START_DATE_DESC: 'ID_DESC',
};

export type DiscoverSelection = {
    genres: Record<string, TagFilterState>;
    tags: Record<string, TagFilterState>;
};

export const EMPTY_SELECTION: DiscoverSelection = { genres: {}, tags: {} };

const namesWithState = (states: Record<string, TagFilterState>, wanted: TagFilterState): string[] =>
    Object.entries(states)
        .filter(([, state]) => state === wanted)
        .map(([name]) => name)
        .sort();

export const hasSelection = ({ genres, tags }: DiscoverSelection): boolean =>
    Object.keys(genres).length > 0 || Object.keys(tags).length > 0;

export const getIncludedTags = ({ tags }: DiscoverSelection): string[] => namesWithState(tags, 'include');

const COUNTRY_BY_TYPE = { MANHWA: 'KR', MANGA: 'JP' } as const;

const nonEmpty = <T>(list: T[]): T[] | undefined => (list.length ? list : undefined);

export type DiscoverVariables = Record<string, unknown>;

/**
 * AniList filter arguments. Filters AniList can apply exactly go server-side to save the 30 req/min budget;
 * the rest (hide in library, min chapters, multi-type, Manhua = CN + TW) stay client-side. Empty lists are omitted
 * because AniList treats an empty `_in` list as "match nothing".
 */
export const buildDiscoverVariables = (selection: DiscoverSelection, filters: RecFilters): DiscoverVariables => {
    const [onlyType] = filters.types;
    const country = filters.types.length === 1 && onlyType !== 'MANHUA' ? COUNTRY_BY_TYPE[onlyType] : undefined;

    const variables: DiscoverVariables = {
        genreIn: nonEmpty(namesWithState(selection.genres, 'include')),
        genreNotIn: nonEmpty(namesWithState(selection.genres, 'exclude')),
        tagIn: nonEmpty(namesWithState(selection.tags, 'include')),
        tagNotIn: nonEmpty(namesWithState(selection.tags, 'exclude')),
        formatNotIn: filters.hideNovelOneShot ? ['NOVEL', 'ONE_SHOT'] : undefined,
        statusIn: nonEmpty([...filters.statuses].sort()),
        country,
        minScore: filters.minScore > 0 ? filters.minScore - 1 : undefined,
        isAdult: filters.showAdult ? undefined : false,
    };

    return Object.fromEntries(Object.entries(variables).filter(([, value]) => value !== undefined));
};

/** Server filters that the client filters (passesFilters) also apply, so dropping them never shows wrong titles. */
const OPTIONAL_FILTER_KEYS = ['formatNotIn', 'statusIn', 'country', 'minScore', 'isAdult'];

export const hasOptionalFilters = (variables: DiscoverVariables): boolean =>
    Object.keys(variables).some((key) => OPTIONAL_FILTER_KEYS.includes(key));

export const stripOptionalFilters = (variables: DiscoverVariables): DiscoverVariables =>
    Object.fromEntries(Object.entries(variables).filter(([key]) => !OPTIONAL_FILTER_KEYS.includes(key)));
