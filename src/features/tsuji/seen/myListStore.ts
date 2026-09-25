/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { DEFAULT_ANILIST_USER, MY_LIST_TTL_MS, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { CompactList, MyListResponse } from '@/features/tsuji/seen/myList.ts';
import { MY_LIST_QUERY, parseMediaListCollection } from '@/features/tsuji/seen/myList.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { useTsujiGlobalMetaQuery } from '@/features/tsuji/services/TsujiMetadata.ts';

type MyListSnapshot = {
    userName: string | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
    list: CompactList | null;
    fetchedAt: number | null;
    failedAt: number | null;
};

/** After a failure, automatic loads wait this long before trying again (the refresh button always retries). */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

type CachedList = { fetchedAt: number; list: CompactList };

/** One list for the whole tab: Discover and every Similar section share it (and its single request). */
let snapshot: MyListSnapshot = { userName: null, status: 'idle', list: null, fetchedAt: null, failedAt: null };
const listeners = new Set<() => void>();
let inFlight: { userName: string; promise: Promise<void> } | null = null;

const setSnapshot = (next: MyListSnapshot) => {
    snapshot = next;
    listeners.forEach((listener) => listener());
};

const subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
};

const getSnapshot = () => snapshot;

const cacheKey = (userName: string) => `myList:v1:${userName.toLowerCase()}`;

/** Cached for 30 minutes; `force` (refresh button) always refetches. Failures keep the last good list. */
export const loadMyList = (userName: string, { force = false }: { force?: boolean } = {}): Promise<void> => {
    if (!force) {
        const cached = TsujiCache.get<CachedList>(cacheKey(userName));
        if (cached) {
            if (snapshot.userName !== userName || snapshot.fetchedAt !== cached.fetchedAt) {
                setSnapshot({
                    userName,
                    status: 'ready',
                    list: cached.list,
                    fetchedAt: cached.fetchedAt,
                    failedAt: null,
                });
            }
            return Promise.resolve();
        }

        if (inFlight?.userName === userName) {
            return inFlight.promise;
        }

        const hasRecentFailure =
            snapshot.userName === userName &&
            snapshot.failedAt !== null &&
            Date.now() - snapshot.failedAt < FAILURE_BACKOFF_MS;
        if (hasRecentFailure) {
            return Promise.resolve();
        }
    }

    const previous = snapshot.userName === userName ? snapshot : null;
    // A known list stays in use (and visible) while it refreshes in the background.
    setSnapshot({
        userName,
        status: 'loading',
        list: previous?.list ?? null,
        fetchedAt: previous?.fetchedAt ?? null,
        failedAt: previous?.failedAt ?? null,
    });

    const promise = aniList
        .request<MyListResponse>(MY_LIST_QUERY, { userName }, { timeoutMs: ANILIST_TIMEOUT_MS.fast })
        .then((data) => {
            const list = parseMediaListCollection(data);
            const fetchedAt = Date.now();
            TsujiCache.set(cacheKey(userName), { fetchedAt, list } satisfies CachedList, MY_LIST_TTL_MS);

            if (snapshot.userName === userName) {
                setSnapshot({ userName, status: 'ready', list, fetchedAt, failedAt: null });
            }
        })
        .catch((error) => {
            defaultPromiseErrorHandler('loadMyList')(error);
            if (snapshot.userName === userName) {
                setSnapshot({ ...snapshot, status: 'error', failedAt: Date.now() });
            }
        })
        .finally(() => {
            if (inFlight?.promise === promise) {
                inFlight = null;
            }
        });

    inFlight = { userName, promise };
    return promise;
};

/** The configured user's public AniList manga list (`tsuji_anilistUser`, default "ejustice"). */
export const useMyAniList = () => {
    const { meta, isLoading: isMetaLoading } = useTsujiGlobalMetaQuery();
    const userName = meta[TSUJI_META_KEYS.anilistUser]?.trim() || DEFAULT_ANILIST_USER;
    const state = useSyncExternalStore(subscribe, getSnapshot);

    useEffect(() => {
        if (!isMetaLoading) {
            loadMyList(userName);
        }
    }, [userName, isMetaLoading]);

    const refresh = useCallback(() => loadMyList(userName, { force: true }), [userName]);

    const isCurrentUser = state.userName === userName;
    const list = isCurrentUser ? state.list : null;
    const status = isCurrentUser ? state.status : 'loading';

    return {
        userName,
        list,
        fetchedAt: isCurrentUser ? state.fetchedAt : null,
        count: list ? Object.keys(list).length : 0,
        isError: status === 'error',
        /** No list at all (first load failed): nothing is hidden, show the notice. */
        isUnavailable: status === 'error' && list === null,
        /**
         * A list is known, or the first load finished (either way). Only the first load blocks cards: a background
         * refresh keeps the current grid and scroll position.
         */
        isSettled: !isMetaLoading && (list !== null || status === 'ready' || status === 'error'),
        refresh,
    };
};
