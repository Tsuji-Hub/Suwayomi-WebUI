/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TRACKER_ID } from '@/features/tsuji/Tsuji.constants.ts';
import type { ComicType, RecMedia, RecMediaStatus } from '@/features/tsuji/recs/Recs.types.ts';
import { getAllTitles, getComicType, getVisibleTags } from '@/features/tsuji/recs/media.ts';
import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';
import type { ScoredCandidate } from '@/features/tsuji/recs/rank.ts';
import { diversify, GEM_MIN_POPULARITY } from '@/features/tsuji/recs/rank.ts';

export type RecSort = 'BEST' | 'SCORE' | 'POPULARITY' | 'NEWEST';

export type TagFilterState = 'include' | 'exclude';

export type RecFilters = {
    hideInLibrary: boolean;
    hideNovelOneShot: boolean;
    /** Empty = all types. */
    types: ComicType[];
    /** Empty = all statuses. */
    statuses: RecMediaStatus[];
    minChapters: number;
    minScore: number;
    showAdult: boolean;
    tags: Record<string, TagFilterState>;
    sort: RecSort;
    hiddenGems: boolean;
};

export const COMIC_TYPES: ComicType[] = ['MANHWA', 'MANGA', 'MANHUA'];
export const REC_STATUSES: RecMediaStatus[] = ['RELEASING', 'FINISHED', 'HIATUS', 'CANCELLED', 'NOT_YET_RELEASED'];
export const MIN_CHAPTER_OPTIONS = [0, 20, 50, 100];
export const MIN_SCORE_OPTIONS = [0, 60, 70, 80, 90];
export const REC_SORTS: RecSort[] = ['BEST', 'SCORE', 'POPULARITY', 'NEWEST'];

export const DEFAULT_REC_FILTERS: RecFilters = {
    hideInLibrary: true,
    hideNovelOneShot: true,
    types: [],
    statuses: [],
    minChapters: 0,
    minScore: 0,
    showAdult: false,
    tags: {},
    sort: 'BEST',
    hiddenGems: false,
};

const pickBoolean = (value: unknown, fallback: boolean): boolean => (typeof value === 'boolean' ? value : fallback);

const pickOption = <T>(value: unknown, options: readonly T[], fallback: T): T =>
    options.includes(value as T) ? (value as T) : fallback;

const pickList = <T>(value: unknown, options: readonly T[]): T[] =>
    Array.isArray(value) ? value.filter((item): item is T => options.includes(item as T)) : [];

const pickTagStates = (value: unknown): Record<string, TagFilterState> => {
    if (!value || typeof value !== 'object') {
        return {};
    }

    return Object.fromEntries(
        Object.entries(value).filter(
            (entry): entry is [string, TagFilterState] => entry[1] === 'include' || entry[1] === 'exclude',
        ),
    );
};

/** Parses the persisted JSON, dropping anything unknown so a stale or hand-edited value can't break the UI. */
export const parseRecFilters = (raw: string | undefined): RecFilters => {
    if (!raw) {
        return DEFAULT_REC_FILTERS;
    }

    let parsed: Record<string, unknown>;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return DEFAULT_REC_FILTERS;
    }

    if (!parsed || typeof parsed !== 'object') {
        return DEFAULT_REC_FILTERS;
    }

    return {
        hideInLibrary: pickBoolean(parsed.hideInLibrary, DEFAULT_REC_FILTERS.hideInLibrary),
        hideNovelOneShot: pickBoolean(parsed.hideNovelOneShot, DEFAULT_REC_FILTERS.hideNovelOneShot),
        types: pickList(parsed.types, COMIC_TYPES),
        statuses: pickList(parsed.statuses, REC_STATUSES),
        minChapters: pickOption(parsed.minChapters, MIN_CHAPTER_OPTIONS, DEFAULT_REC_FILTERS.minChapters),
        minScore: pickOption(parsed.minScore, MIN_SCORE_OPTIONS, DEFAULT_REC_FILTERS.minScore),
        showAdult: pickBoolean(parsed.showAdult, DEFAULT_REC_FILTERS.showAdult),
        tags: pickTagStates(parsed.tags),
        sort: pickOption(parsed.sort, REC_SORTS, DEFAULT_REC_FILTERS.sort),
        hiddenGems: pickBoolean(parsed.hiddenGems, DEFAULT_REC_FILTERS.hiddenGems),
    };
};

/** Number of filters that differ from the defaults (sort excluded), for the filter button badge. */
export const countActiveFilters = (filters: RecFilters): number =>
    [
        filters.hideInLibrary !== DEFAULT_REC_FILTERS.hideInLibrary,
        filters.hideNovelOneShot !== DEFAULT_REC_FILTERS.hideNovelOneShot,
        filters.types.length > 0,
        filters.statuses.length > 0,
        filters.minChapters !== DEFAULT_REC_FILTERS.minChapters,
        filters.minScore !== DEFAULT_REC_FILTERS.minScore,
        filters.showAdult !== DEFAULT_REC_FILTERS.showAdult,
        filters.hiddenGems !== DEFAULT_REC_FILTERS.hiddenGems,
    ].filter(Boolean).length + Object.keys(filters.tags).length;

export type LibraryIndex = { anilistIds: Set<number>; malIds: Set<number>; titles: Set<string> };

export type LibraryIndexManga = {
    title: string;
    trackRecords: { nodes: { trackerId: number; remoteId: string }[] };
};

export const EMPTY_LIBRARY_INDEX: LibraryIndex = { anilistIds: new Set(), malIds: new Set(), titles: new Set() };

export const buildLibraryIndex = (mangas: LibraryIndexManga[]): LibraryIndex => {
    const index: LibraryIndex = { anilistIds: new Set(), malIds: new Set(), titles: new Set() };

    mangas.forEach(({ title, trackRecords }) => {
        const titleKey = normalizeTitle(title);
        if (titleKey) {
            index.titles.add(titleKey);
        }

        trackRecords.nodes.forEach(({ trackerId, remoteId }) => {
            const id = Number(remoteId);
            if (!Number.isInteger(id) || id <= 0) {
                return;
            }

            if (trackerId === TRACKER_ID.ANILIST) {
                index.anilistIds.add(id);
            }
            if (trackerId === TRACKER_ID.MAL) {
                index.malIds.add(id);
            }
        });
    });

    return index;
};

export const isInLibrary = (media: Pick<RecMedia, 'id' | 'idMal' | 'title'>, index: LibraryIndex): boolean =>
    index.anilistIds.has(media.id) ||
    (media.idMal !== null && index.malIds.has(media.idMal)) ||
    getAllTitles(media).some((title) => {
        const titleKey = normalizeTitle(title);
        return titleKey !== '' && index.titles.has(titleKey);
    });

const passesTagFilters = (media: RecMedia, tagStates: Record<string, TagFilterState>): boolean => {
    const visibleTags = new Set(getVisibleTags(media).map(({ name }) => name));
    const allTags = new Set((media.tags ?? []).map(({ name }) => name));

    return Object.entries(tagStates).every(([name, state]) =>
        state === 'include' ? visibleTags.has(name) : !allTags.has(name),
    );
};

export const passesFilters = (
    media: RecMedia,
    filters: RecFilters,
    libraryIndex: LibraryIndex,
    { applyTagFilters = true }: { applyTagFilters?: boolean } = {},
): boolean => {
    if (filters.hideInLibrary && isInLibrary(media, libraryIndex)) {
        return false;
    }

    if (filters.hideNovelOneShot && (media.format === 'NOVEL' || media.format === 'ONE_SHOT')) {
        return false;
    }

    const comicType = getComicType(media.countryOfOrigin);
    if (filters.types.length && (!comicType || !filters.types.includes(comicType))) {
        return false;
    }

    if (filters.statuses.length && !filters.statuses.includes(media.status as RecMediaStatus)) {
        return false;
    }

    // Unknown chapter counts (ongoing series on AniList) always pass; a missing score counts as 0.
    if (media.chapters !== null && media.chapters < filters.minChapters) {
        return false;
    }

    if ((media.averageScore ?? 0) < filters.minScore) {
        return false;
    }

    if (media.isAdult && !filters.showAdult) {
        return false;
    }

    if (filters.hiddenGems && (media.popularity ?? 0) < GEM_MIN_POPULARITY) {
        return false;
    }

    return !applyTagFilters || passesTagFilters(media, filters.tags);
};

const byPopularity = (a: Pick<RecMedia, 'popularity'>, b: Pick<RecMedia, 'popularity'>): number =>
    (b.popularity ?? 0) - (a.popularity ?? 0);

const startDateValue = ({ startDate }: Pick<RecMedia, 'startDate'>): number =>
    startDate?.year ? startDate.year * 10_000 + (startDate.month ?? 0) * 100 + (startDate.day ?? 0) : 0;

export const sortRecs = (scored: ScoredCandidate[], { sort, hiddenGems }: Pick<RecFilters, 'sort' | 'hiddenGems'>) => {
    switch (sort) {
        case 'SCORE':
            return [...scored].sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1) || byPopularity(a, b));
        case 'POPULARITY':
            return [...scored].sort(byPopularity);
        case 'NEWEST':
            return [...scored].sort((a, b) => startDateValue(b) - startDateValue(a) || byPopularity(a, b));
        case 'BEST': {
            const relevance = (item: ScoredCandidate) => (hiddenGems ? item.gem : item.bestMatch);
            const sorted = [...scored].sort((a, b) => relevance(b) - relevance(a) || byPopularity(a, b));

            return diversify(sorted, relevance);
        }
        default:
            throw new Error(`sortRecs: unexpected sort "${sort satisfies never}"`);
    }
};

/** Tri-state tag options from the loaded recs: non-spoiler, adult only when allowed, most common first. */
export const getTagOptions = (medias: RecMedia[], showAdult: boolean): string[] => {
    const counts = new Map<string, number>();

    medias.forEach((media) =>
        getVisibleTags(media)
            .filter((tag) => showAdult || !tag.isAdult)
            .forEach(({ name }) => counts.set(name, (counts.get(name) ?? 0) + 1)),
    );

    return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
};
