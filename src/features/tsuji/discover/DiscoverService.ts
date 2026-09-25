/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { RECS_CACHE_TTL_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { DiscoverVariables } from '@/features/tsuji/discover/discoverQuery.ts';
import { hasOptionalFilters, SORT_FALLBACKS, stripOptionalFilters } from '@/features/tsuji/discover/discoverQuery.ts';
import type { CatalogTag, DiscoverPageResponse, TagCatalogResponse } from '@/features/tsuji/recs/aniListQueries.ts';
import { DISCOVER_PAGE_QUERY, TAG_CATALOG_QUERY } from '@/features/tsuji/recs/aniListQueries.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { aniList } from '@/features/tsuji/services/AniListClient.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';

const PER_PAGE = 30;
const TAG_CATALOG_CACHE_KEY = 'tagCatalog:v1';

export type TagCatalog = { tags: CatalogTag[]; genres: string[] };

let pendingCatalog: Promise<TagCatalog> | null = null;

/** MediaTagCollection + GenreCollection, fetched once and cached 7 days. */
export const loadTagCatalog = (): Promise<TagCatalog> => {
    const cached = TsujiCache.get<TagCatalog>(TAG_CATALOG_CACHE_KEY);
    if (cached) {
        return Promise.resolve(cached);
    }

    if (!pendingCatalog) {
        pendingCatalog = aniList
            .request<TagCatalogResponse>(TAG_CATALOG_QUERY, {})
            .then((data) => {
                const catalog: TagCatalog = {
                    tags: data.MediaTagCollection ?? [],
                    genres: data.GenreCollection ?? [],
                };
                TsujiCache.set(TAG_CATALOG_CACHE_KEY, catalog, RECS_CACHE_TTL_MS);
                return catalog;
            })
            .finally(() => {
                pendingCatalog = null;
            });
    }

    return pendingCatalog;
};

export type DiscoverPage = {
    media: RecMedia[];
    hasNextPage: boolean;
    /** Sort actually used (differs from the requested one after a fallback). */
    serverSort: string;
    /** Optional server filters were dropped (client filters still apply); later pages must match. */
    isRelaxed: boolean;
};

type FetchedPage = Pick<DiscoverPage, 'media' | 'hasNextPage'>;

/** Session memo so navigating Discover -> global search -> back doesn't spend the rate budget again. */
const pageMemo = new Map<string, FetchedPage>();
/** Sorts found broken this session (see SORT_FALLBACKS). */
const brokenSorts = new Map<string, string>();

const fetchPage = async (
    variables: DiscoverVariables,
    serverSort: string,
    page: number,
    signal: AbortSignal,
): Promise<FetchedPage> => {
    const memoKey = JSON.stringify({ variables, serverSort, page });
    const memoized = pageMemo.get(memoKey);
    if (memoized) {
        return memoized;
    }

    const { Page } = await aniList.request<DiscoverPageResponse>(
        DISCOVER_PAGE_QUERY,
        { ...variables, page, perPage: PER_PAGE, sort: [serverSort] },
        signal,
    );
    const result = { media: Page?.media ?? [], hasNextPage: !!Page?.pageInfo?.hasNextPage };

    // Empty pages aren't memoized: degraded AniList sometimes returns nothing for a valid query.
    if (result.media.length) {
        pageMemo.set(memoKey, result);
    }

    return result;
};

/**
 * Loads one Discover page. For page 1, an empty result triggers up to two retries, because degraded AniList
 * (2026-09) intermittently returns nothing for some arguments (format_not_in, isAdult) and some sorts
 * (TRENDING_DESC, START_DATE_DESC): first without the optional server filters (client filters cover them),
 * then with the fallback sort. Later pages reuse whatever page 1 settled on.
 */
export const loadDiscoverPage = async ({
    variables,
    serverSort,
    page,
    isRelaxed = false,
    signal,
}: {
    variables: DiscoverVariables;
    serverSort: string;
    page: number;
    isRelaxed?: boolean;
    signal: AbortSignal;
}): Promise<DiscoverPage> => {
    const effectiveSort = page === 1 ? (brokenSorts.get(serverSort) ?? serverSort) : serverSort;
    const effectiveVariables = isRelaxed ? stripOptionalFilters(variables) : variables;
    const result = await fetchPage(effectiveVariables, effectiveSort, page, signal);

    if (page !== 1 || result.media.length) {
        return { ...result, serverSort: effectiveSort, isRelaxed };
    }

    if (hasOptionalFilters(effectiveVariables)) {
        const relaxed = await fetchPage(stripOptionalFilters(effectiveVariables), effectiveSort, 1, signal);
        if (relaxed.media.length) {
            return { ...relaxed, serverSort: effectiveSort, isRelaxed: true };
        }
    }

    const fallbackSort = SORT_FALLBACKS[effectiveSort];
    if (fallbackSort) {
        const fallback = await fetchPage(stripOptionalFilters(effectiveVariables), fallbackSort, 1, signal);

        // Same filters, different sort: results only under the fallback mean the primary sort is broken.
        if (fallback.media.length) {
            brokenSorts.set(serverSort, fallbackSort);
            return { ...fallback, serverSort: fallbackSort, isRelaxed: true };
        }
    }

    return { ...result, serverSort: effectiveSort, isRelaxed };
};
