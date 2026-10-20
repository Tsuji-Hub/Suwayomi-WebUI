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
import { buildBakaSearch, getMissingDetails, toBakaCards } from '@/features/tsuji/tags/baka.ts';
import {
    fetchAniListDetails,
    getSearchLimit,
    searchBakaSeries,
    searchBakaTags,
} from '@/features/tsuji/tags/bakaService.ts';
import { normalizeTagKey } from '@/features/tsuji/tags/tagKeys.ts';

type ResolvedChips = { include: string[]; excludeIds: number[]; postFilter: AniListChips };

/**
 * The search terms of a selection: MangaBaka chips by tag; AniList-only chips ride along as the MangaBaka tag with
 * the same name when there is one (tag lookups are cached a week), else they stay a post-filter on AniList details.
 */
export const resolveChips = async (
    baka: BakaSelection,
    aniListChips: AniListChips,
    signal: AbortSignal,
): Promise<ResolvedChips> => {
    const resolved: ResolvedChips = {
        include: Object.values(baka)
            .filter(({ state }) => state === 'include')
            .map(({ bakaTag }) => bakaTag.name),
        excludeIds: Object.values(baka)
            .filter(({ state }) => state === 'exclude')
            .map(({ bakaTag }) => bakaTag.id),
        postFilter: { genres: {}, tags: {} },
    };
    const aniListOnly = (['genres', 'tags'] as const).flatMap((kind) =>
        Object.entries(aniListChips[kind]).map(([name, state]) => ({ kind, name, state })),
    );
    for (const { kind, name, state } of aniListOnly) {
        // oxlint-disable-next-line no-await-in-loop
        const tags = await searchBakaTags(name, signal).catch(() => []);
        const same = tags.find((tag) => normalizeTagKey(tag.name) === normalizeTagKey(name));
        if (!same) {
            resolved.postFilter[kind][name] = state;
        } else if (state === 'include') {
            resolved.include.push(same.name);
        } else {
            resolved.excludeIds.push(same.id);
        }
    }
    return resolved;
};

type BakaFeedState = {
    key: string;
    pages: BakaSeries[][];
    postFilter: AniListChips;
    hasNextPage: boolean;
    status: 'idle' | 'loading' | 'error';
};

const createState = (key: string): BakaFeedState => ({
    key,
    pages: [],
    postFilter: { genres: {}, tags: {} },
    hasNextPage: true,
    status: 'idle',
});

/**
 * Paged MangaBaka feed with the same shape as useDiscoverFeed (Discover swaps them by search engine). A page shows
 * as soon as MangaBaka answers; its AniList details follow in one `id_in` request and fill the cards in.
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
    const resolvedRef = useRef<Promise<ResolvedChips> | null>(null);

    useEffect(() => {
        controllerRef.current?.abort();
        controllerRef.current = new AbortController();
        resolvedRef.current = null;
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
        resolvedRef.current ??= resolveChips(baka, aniListChips, signal);
        const page = feed.pages.length + 1;
        const search = (resolved: ResolvedChips) =>
            searchBakaSeries(
                buildBakaSearch({
                    ...resolved,
                    types,
                    sort,
                    minScore,
                    showAdult,
                    page,
                    limit: getSearchLimit(),
                }),
                signal,
            );
        resolvedRef.current
            .then(async (resolved) => {
                const limit = getSearchLimit();
                // A first page refused for its size is asked again at the smaller size (learned for the session).
                const result = await search(resolved).catch((error) =>
                    page === 1 && getSearchLimit() !== limit ? search(resolved) : Promise.reject(error),
                );
                return { resolved, result };
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
                resolvedRef.current = null;
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
        loadMore,
        retry,
    };
};
