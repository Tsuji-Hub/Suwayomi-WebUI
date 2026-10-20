/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { FeedPhase } from '@/features/tsuji/discover/landing.ts';
import type { ComicType, RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { AniListChips, BakaSelection, BakaSeries } from '@/features/tsuji/tags/baka.ts';
import {
    BAKA_FAMILIES,
    buildBakaSearch,
    compareBakaSeries,
    countBakaCombinations,
    getBakaCombinations,
    getChipTags,
    getMissingDetails,
    toBakaCards,
} from '@/features/tsuji/tags/baka.ts';
import { createBakaMerge } from '@/features/tsuji/tags/bakaMerge.ts';
import {
    fetchAniListDetails,
    getSearchLimit,
    searchBakaSeries,
    searchBakaTags,
} from '@/features/tsuji/tags/bakaService.ts';
import { normalizeTagKey } from '@/features/tsuji/tags/tagKeys.ts';

/** Tag ids per included chip (OR inside, AND across), excluded ids, and what stays an AniList post-filter. */
export type ResolvedChips = { includeSets: number[][]; excludeIds: number[]; postFilter: AniListChips };

/**
 * The search terms of a selection, as MangaBaka tag ids only (a name would miss the tag's subtags, and a name mixed
 * with an id finds nothing): MangaBaka chips by their tags; AniList-only chips ride along as the family or the
 * MangaBaka tag with the same name when there is one (tag lookups are cached a week), else they stay a post-filter
 * on AniList details.
 */
export const resolveChips = async (
    baka: BakaSelection,
    aniListChips: AniListChips,
    signal: AbortSignal,
): Promise<ResolvedChips> => {
    const chips = Object.values(baka);
    const resolved: ResolvedChips = {
        includeSets: chips
            .filter(({ state }) => state === 'include')
            .map((chip) => getChipTags(chip).map(({ id }) => id)),
        excludeIds: chips
            .filter(({ state }) => state === 'exclude')
            .flatMap((chip) => getChipTags(chip).map(({ id }) => id)),
        postFilter: { genres: {}, tags: {} },
    };
    const aniListOnly = (['genres', 'tags'] as const).flatMap((kind) =>
        Object.entries(aniListChips[kind]).map(([name, state]) => ({ kind, name, state })),
    );
    // Lookups for every AniList-only chip at once (cached a week; a family needs none).
    const lookups = await Promise.all(
        aniListOnly.map(async ({ name }) => {
            const key = normalizeTagKey(name);
            const family = BAKA_FAMILIES.find((each) => each.key === key);
            if (family) {
                return family.tags.map(({ id }) => id);
            }
            const tags = await searchBakaTags(name, signal).catch(() => []);
            const same = tags.find((tag) => normalizeTagKey(tag.name) === key);
            return same ? [same.id] : [];
        }),
    );
    aniListOnly.forEach(({ kind, name, state }, index) => {
        const ids = lookups[index];
        if (!ids.length) {
            resolved.postFilter[kind][name] = state;
        } else if (state === 'include') {
            resolved.includeSets.push(ids);
        } else {
            resolved.excludeIds.push(...ids);
        }
    });
    return resolved;
};

type BakaMerge = ReturnType<typeof createBakaMerge>;

type BakaFeedState = {
    key: string;
    pages: BakaSeries[][];
    postFilter: AniListChips;
    hasNextPage: boolean;
    status: 'idle' | 'loading' | 'error';
    /** Sub-searches run / needed without the cap (null until the chips are resolved). */
    combinations: { used: number; total: number } | null;
    /** Sub-searches whose first page is in (the first cards wait for all of them). */
    firstPagesLoaded: number;
};

const createState = (key: string): BakaFeedState => ({
    key,
    pages: [],
    postFilter: { genres: {}, tags: {} },
    hasNextPage: true,
    status: 'idle',
    combinations: null,
    firstPagesLoaded: 0,
});

type MergedSearch = { resolved: ResolvedChips; merge: BakaMerge; limit: number };

/**
 * Paged MangaBaka feed with the same shape as useDiscoverFeed (Discover swaps them by search engine). One
 * sub-search per tag combination, merged in order without repeats (brief #11). A page shows as soon as MangaBaka
 * answers; its AniList details follow in one `id_in` request and fill the cards in.
 */
export const useBakaFeed = ({
    baka,
    aniListChips,
    types,
    sort,
    minScore,
    showAdult,
    isEnabled,
}: {
    baka: BakaSelection;
    aniListChips: AniListChips;
    types: ComicType[];
    sort: string;
    minScore: number;
    showAdult: boolean;
    isEnabled: boolean;
}) => {
    const key = useMemo(
        () => JSON.stringify({ baka, aniListChips, types, sort, minScore, showAdult }),
        [baka, aniListChips, types, sort, minScore, showAdult],
    );
    const [state, setState] = useState<BakaFeedState>(() => createState(key));
    const current = state.key === key ? state : createState(key);
    const currentRef = useRef(current);
    currentRef.current = current;
    // AniList details are per id, whatever the selection, so they outlive a selection change.
    const [details, setDetails] = useState<ReadonlyMap<number, RecMedia | null>>(() => new Map());
    const detailsRef = useRef(details);
    detailsRef.current = details;
    const controllerRef = useRef<AbortController | null>(null);
    const searchRef = useRef<Promise<MergedSearch> | null>(null);

    useEffect(() => {
        controllerRef.current?.abort();
        controllerRef.current = new AbortController();
        searchRef.current = null;
        setState(createState(key));
    }, [key]);
    useEffect(() => () => controllerRef.current?.abort(), []);

    const loadMore = useCallback(() => {
        const feed = currentRef.current;
        const controller = controllerRef.current;
        if (!isEnabled || !controller || feed.status === 'loading' || !feed.hasNextPage) {
            return;
        }
        const { signal } = controller;
        setState({ ...feed, status: 'loading' });
        const start = async (): Promise<MergedSearch> => {
            const resolved = await resolveChips(baka, aniListChips, signal);
            const combinations = getBakaCombinations(resolved.includeSets);
            const limit = getSearchLimit();
            const update = (change: (previous: BakaFeedState) => Partial<BakaFeedState>) =>
                setState((previous) => (previous.key === feed.key ? { ...previous, ...change(previous) } : previous));
            update(() => ({
                combinations: { used: combinations.length, total: countBakaCombinations(resolved.includeSets) },
                firstPagesLoaded: 0,
            }));
            const merge = createBakaMerge({
                sourceCount: combinations.length,
                compare: compareBakaSeries(sort),
                fetchPage: async (source, page) => {
                    const result = await searchBakaSeries(
                        buildBakaSearch({
                            tagIds: combinations[source],
                            excludeIds: resolved.excludeIds,
                            types,
                            sort,
                            minScore,
                            showAdult,
                            page,
                            limit,
                        }),
                        signal,
                    );
                    if (page === 1 && !signal.aborted) {
                        update((previous) => ({ firstPagesLoaded: previous.firstPagesLoaded + 1 }));
                    }
                    return result;
                },
            });
            return { resolved, merge, limit };
        };
        const limitBefore = getSearchLimit();
        const readPage = async () => {
            // A failed start is forgotten (the next try starts over); a failed page keeps the merge's cursors.
            searchRef.current ??= start().catch((error) => {
                searchRef.current = null;
                throw error;
            });
            const search = await searchRef.current;
            const series = await search.merge.next(search.limit);
            return { resolved: search.resolved, result: { series, hasNextPage: search.merge.hasNext() } };
        };
        readPage()
            .catch((error) => {
                // A first page refused for its size is asked again at the smaller size (learned for the session).
                if (feed.pages.length || getSearchLimit() === limitBefore) {
                    return Promise.reject(error);
                }
                searchRef.current = null;
                return readPage();
            })
            .then(({ resolved, result }) => {
                if (signal.aborted) {
                    return;
                }
                setState((previous) =>
                    previous.key === feed.key
                        ? {
                              ...previous,
                              pages: [...previous.pages, result.series],
                              postFilter: resolved.postFilter,
                              hasNextPage: result.hasNextPage,
                              status: 'idle',
                          }
                        : previous,
                );
                const missing = getMissingDetails(result.series, detailsRef.current);
                if (missing.length) {
                    fetchAniListDetails(missing, signal)
                        .then((batch) => !signal.aborted && setDetails((previous) => new Map([...previous, ...batch])))
                        .catch((error) => !signal.aborted && defaultPromiseErrorHandler('useBakaFeed::details')(error));
                }
            })
            .catch((error) => {
                if (signal.aborted) {
                    return;
                }
                defaultPromiseErrorHandler('useBakaFeed')(error);
                setState((previous) => (previous.key === feed.key ? { ...previous, status: 'error' } : previous));
            });
    }, [isEnabled, baka, aniListChips, types, sort, minScore, showAdult]);

    const shouldLoadFirstPage = isEnabled && !current.pages.length && current.status === 'idle';
    useEffect(() => {
        if (shouldLoadFirstPage) {
            loadMore();
        }
    }, [shouldLoadFirstPage, loadMore]);

    const pages = useMemo(
        () => toBakaCards(current.pages, details, current.postFilter),
        [current.pages, details, current.postFilter],
    );

    const retry = useCallback(() => setState((previous) => ({ ...previous, status: 'idle' })), []);
    const phase = ((): FeedPhase => {
        if (!isEnabled) {
            return 'off';
        }
        if (pages.length) {
            return pages.some((page) => page.length) ? 'ready' : 'empty';
        }
        return current.status === 'error' ? 'failed' : 'pending';
    })();

    return {
        phase,
        pages,
        hasNextPage: current.hasNextPage,
        isLoading: current.status === 'loading' || (isEnabled && !current.pages.length && current.status === 'idle'),
        isError: current.status === 'error',
        serverSort: null as string | null,
        combinations: current.combinations,
        firstPagesLoaded: current.firstPagesLoaded,
        loadMore,
        retry,
    };
};
