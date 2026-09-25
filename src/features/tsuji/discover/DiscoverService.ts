/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { RECS_CACHE_TTL_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { DiscoverVariables } from '@/features/tsuji/discover/discoverQuery.ts';
import {
    hasOptionalFilters,
    matchesOptionalFilters,
    SORT_FALLBACKS,
    stripOptionalFilters,
} from '@/features/tsuji/discover/discoverQuery.ts';
import type { CatalogTag, DiscoverPageResponse, TagCatalogResponse } from '@/features/tsuji/recs/aniListQueries.ts';
import { DISCOVER_PAGE_QUERY, TAG_CATALOG_QUERY } from '@/features/tsuji/recs/aniListQueries.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { aniList, ANILIST_TIMEOUT_MS, isAniListTimeout } from '@/features/tsuji/services/AniListClient.ts';
import { DegradedMemory } from '@/features/tsuji/discover/degradedMemory.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';

/**
 * AniList's maximum. Client-side filters (library, your list, multi-type, novels) can drop most of a page, so bigger
 * pages mean more visible cards per rate-limited request.
 */
const PER_PAGE = 50;
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
            .request<TagCatalogResponse>(TAG_CATALOG_QUERY, {}, { timeoutMs: ANILIST_TIMEOUT_MS.slow })
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

const fetchPage = async (
    variables: DiscoverVariables,
    serverSort: string,
    page: number,
    timeoutMs: number,
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
        { signal, timeoutMs },
    );
    const result = { media: Page?.media ?? [], hasNextPage: !!Page?.pageInfo?.hasNextPage };

    // Empty pages aren't memoized: degraded AniList sometimes returns nothing for a valid query.
    if (result.media.length) {
        pageMemo.set(memoKey, result);
    }

    return result;
};

type Attempt =
    | { kind: 'ok'; page: FetchedPage }
    | { kind: 'empty'; page: FetchedPage }
    | { kind: 'timeout'; error: unknown };

const attempt = async (
    variables: DiscoverVariables,
    serverSort: string,
    timeoutMs: number,
    signal: AbortSignal,
): Promise<Attempt> => {
    try {
        const page = await fetchPage(variables, serverSort, 1, timeoutMs, signal);
        return page.media.length ? { kind: 'ok', page } : { kind: 'empty', page };
    } catch (error) {
        if (isAniListTimeout(error) && !signal.aborted) {
            return { kind: 'timeout', error };
        }
        throw error;
    }
};

/**
 * Loads one Discover page. Page 1 walks a short chain because degraded AniList (2026-09) intermittently returns
 * nothing, or answers in ~10 s, for some sorts (TRENDING_DESC, START_DATE_DESC) and filters:
 *   1. as asked (4 s if a retry follows, else 12 s);
 *   2. without the optional server filters (client filters still enforce them);
 *   3. with the fallback sort (12 s), when `allowSortFallback`.
 * What worked is remembered for 30 minutes (DegradedMemory), so later loads skip straight to it. Later pages reuse
 * the sort/relaxation page 1 settled on. A final timeout is thrown (retry UI); an empty result is a real "no matches".
 */
export const loadDiscoverPage = async ({
    variables,
    serverSort,
    page,
    isRelaxed = false,
    allowSortFallback = true,
    signal,
}: {
    variables: DiscoverVariables;
    serverSort: string;
    page: number;
    isRelaxed?: boolean;
    allowSortFallback?: boolean;
    signal: AbortSignal;
}): Promise<DiscoverPage> => {
    if (page > 1) {
        const variablesForPage = isRelaxed ? stripOptionalFilters(variables) : variables;
        const result = await fetchPage(variablesForPage, serverSort, page, ANILIST_TIMEOUT_MS.slow, signal);
        return { ...result, serverSort, isRelaxed };
    }

    const fallbackSort = allowSortFallback ? SORT_FALLBACKS[serverSort] : undefined;
    if (fallbackSort && DegradedMemory.isSortFailed(serverSort)) {
        const known = await attempt(stripOptionalFilters(variables), fallbackSort, ANILIST_TIMEOUT_MS.slow, signal);
        if (known.kind === 'timeout') {
            throw known.error;
        }
        return { ...known.page, serverSort: fallbackSort, isRelaxed: true };
    }

    const shouldRelax = isRelaxed || (DegradedMemory.shouldRelaxFilters() && hasOptionalFilters(variables));
    const firstVariables = shouldRelax ? stripOptionalFilters(variables) : variables;
    const canRelax = hasOptionalFilters(firstVariables);
    const hasRetry = canRelax || !!fallbackSort;

    const first = await attempt(
        firstVariables,
        serverSort,
        hasRetry ? ANILIST_TIMEOUT_MS.fast : ANILIST_TIMEOUT_MS.slow,
        signal,
    );
    if (first.kind === 'ok') {
        return { ...first.page, serverSort, isRelaxed: shouldRelax };
    }

    // After a timeout on a sort that has a fallback, retrying the same slow sort without filters rarely helps.
    if (canRelax && !(first.kind === 'timeout' && fallbackSort)) {
        const relaxed = await attempt(
            stripOptionalFilters(firstVariables),
            serverSort,
            fallbackSort ? ANILIST_TIMEOUT_MS.fast : ANILIST_TIMEOUT_MS.slow,
            signal,
        );
        // Only evidence of degradation if relaxed titles still satisfy the dropped filters; otherwise the filter
        // combination simply has no matches, and "no matches" is the right answer.
        const isDegraded =
            relaxed.kind === 'ok' &&
            (first.kind === 'timeout' ||
                relaxed.page.media.some((media) => matchesOptionalFilters(media, firstVariables)));
        if (isDegraded) {
            DegradedMemory.rememberRelaxFilters();
            return { ...relaxed.page, serverSort, isRelaxed: true };
        }
    }

    if (fallbackSort) {
        const fallback = await attempt(
            stripOptionalFilters(firstVariables),
            fallbackSort,
            ANILIST_TIMEOUT_MS.slow,
            signal,
        );

        // Results only under the fallback (same filters) mean the primary sort is what's broken. If the fallback
        // failed too, AniList is down broadly: remember nothing.
        if (fallback.kind === 'ok') {
            DegradedMemory.rememberSortFailed(serverSort);
            return { ...fallback.page, serverSort: fallbackSort, isRelaxed: true };
        }
    }

    if (first.kind === 'timeout') {
        throw first.error;
    }

    return { ...first.page, serverSort, isRelaxed: shouldRelax };
};
