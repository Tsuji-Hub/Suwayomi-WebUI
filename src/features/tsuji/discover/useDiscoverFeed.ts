/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { DiscoverVariables } from '@/features/tsuji/discover/discoverQuery.ts';
import type { TagCatalog } from '@/features/tsuji/discover/DiscoverService.ts';
import { loadDiscoverPage, loadTagCatalog } from '@/features/tsuji/discover/DiscoverService.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { FeedPhase } from '@/features/tsuji/discover/landing.ts';

type FeedState = {
    key: string;
    pages: RecMedia[][];
    hasNextPage: boolean;
    /** Sort actually used by AniList (differs from the requested one after a fallback). */
    serverSort: string | null;
    isRelaxed: boolean;
    status: 'idle' | 'loading' | 'error';
};

const createFeedState = (key: string): FeedState => ({
    key,
    pages: [],
    hasNextPage: true,
    serverSort: null,
    isRelaxed: false,
    status: 'idle',
});

/** Paged AniList feed. Page 1 loads automatically; later pages load via `loadMore` (infinite scroll). */
export const useDiscoverFeed = ({
    variables,
    serverSort,
    isEnabled = true,
    allowSortFallback = true,
}: {
    variables: DiscoverVariables;
    serverSort: string;
    isEnabled?: boolean;
    /** Off for landing Trending: Popular is loaded in parallel anyway. */
    allowSortFallback?: boolean;
}) => {
    const key = useMemo(() => JSON.stringify({ variables, serverSort }), [variables, serverSort]);
    const [state, setState] = useState<FeedState>(() => createFeedState(key));
    const controllerRef = useRef<AbortController | null>(null);

    const current = state.key === key ? state : createFeedState(key);
    const currentRef = useRef(current);
    currentRef.current = current;

    useEffect(() => {
        controllerRef.current?.abort();
        setState(createFeedState(key));
    }, [key]);

    useEffect(() => () => controllerRef.current?.abort(), []);

    const loadMore = useCallback(() => {
        const feed = currentRef.current;
        if (!isEnabled || feed.status === 'loading' || !feed.hasNextPage) {
            return;
        }

        const controller = new AbortController();
        controllerRef.current = controller;
        setState({ ...feed, status: 'loading' });

        loadDiscoverPage({
            variables,
            serverSort: feed.serverSort ?? serverSort,
            page: feed.pages.length + 1,
            isRelaxed: feed.isRelaxed,
            allowSortFallback,
            signal: controller.signal,
        })
            .then((page) => {
                if (controller.signal.aborted) {
                    return;
                }

                setState((previous) =>
                    previous.key === feed.key
                        ? {
                              ...previous,
                              pages: [...previous.pages, page.media],
                              hasNextPage: page.hasNextPage,
                              serverSort: page.serverSort,
                              isRelaxed: page.isRelaxed,
                              status: 'idle',
                          }
                        : previous,
                );
            })
            .catch((error) => {
                if (controller.signal.aborted) {
                    return;
                }

                defaultPromiseErrorHandler('useDiscoverFeed')(error);
                setState((previous) => (previous.key === feed.key ? { ...previous, status: 'error' } : previous));
            });
    }, [isEnabled, variables, serverSort, allowSortFallback]);

    const shouldLoadFirstPage = isEnabled && !current.pages.length && current.status === 'idle';
    useEffect(() => {
        if (shouldLoadFirstPage) {
            loadMore();
        }
    }, [shouldLoadFirstPage, loadMore]);

    const retry = useCallback(() => setState((previous) => ({ ...previous, status: 'idle' })), []);

    const phase = ((): FeedPhase => {
        if (!isEnabled) {
            return 'off';
        }
        if (current.pages.length) {
            return current.pages[0].length ? 'ready' : 'empty';
        }
        return current.status === 'error' ? 'failed' : 'pending';
    })();

    return {
        phase,
        pages: current.pages,
        hasNextPage: current.hasNextPage,
        isLoading: current.status === 'loading' || (isEnabled && !current.pages.length && current.status === 'idle'),
        isError: current.status === 'error',
        serverSort: current.serverSort,
        loadMore,
        retry,
    };
};

/** Tag catalog for the picker; null while loading. Loads only once `isEnabled` (the picker is opened). */
export const useTagCatalog = (isEnabled: boolean) => {
    const [catalog, setCatalog] = useState<TagCatalog | null>(null);
    const [isError, setIsError] = useState(false);
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (!isEnabled || catalog) {
            return undefined;
        }

        let isActive = true;
        setIsError(false);

        loadTagCatalog()
            .then((result) => isActive && setCatalog(result))
            .catch((error) => {
                defaultPromiseErrorHandler('useTagCatalog')(error);
                if (isActive) {
                    setIsError(true);
                }
            });

        return () => {
            isActive = false;
        };
    }, [isEnabled, attempt]);

    const retry = useCallback(() => setAttempt((value) => value + 1), []);

    return { catalog, isError, retry };
};
