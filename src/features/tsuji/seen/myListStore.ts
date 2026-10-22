/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useSyncExternalStore } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { DAY_MS, DEFAULT_ANILIST_USER, MY_LIST_TTL_MS, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { CompactList, ListTitleIndex, MyListResponse } from '@/features/tsuji/seen/myList.ts';
import { MY_LIST_QUERY, parseListTitleIndex, parseMediaListCollection } from '@/features/tsuji/seen/myList.ts';
import { readListTitleIndex, writeListTitleIndex } from '@/features/tsuji/seen/listTitles.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { readFreshTsujiRawGlobalMeta, useTsujiGlobalMetaQuery } from '@/features/tsuji/services/TsujiMetadata.ts';
import { parseSavedList } from '@/features/tsuji/seen/alListCache.ts';

type MyListSnapshot = {
    userName: string | null;
    status: 'idle' | 'loading' | 'ready' | 'error';
    list: CompactList | null;
    fetchedAt: number | null;
    failedAt: number | null;
    /** The list in use is a saved copy (AniList failed): when it was taken, epoch ms. */
    savedAt: number | null;
};

/** After a failure, automatic loads wait this long before trying again (the refresh button always retries). */
const FAILURE_BACKOFF_MS = 5 * 60 * 1000;

type CachedList = { fetchedAt: number; list: CompactList };

/** One list for the whole tab: Discover and every Similar section share it (and its single request). */
let snapshot: MyListSnapshot = {
    userName: null,
    status: 'idle',
    list: null,
    fetchedAt: null,
    failedAt: null,
    savedAt: null,
};
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
/** The last list AniList gave, kept a month: what hides titles while AniList is down (brief #15). */
const lastKey = (userName: string) => `myList:last:v1:${userName.toLowerCase()}`;
const LAST_LIST_TTL_MS = 30 * DAY_MS;

/**
 * The newest saved copy of the list while AniList fails: this browser's last list from AniList (a month), or the
 * server's copy in global meta (`tsuji_alListCache`, kept by a PVE timer; also lends its titles to the title index
 * for Comick cards). Null when there is neither.
 */
const loadSavedCopy = async (userName: string): Promise<{ list: CompactList; at: number } | null> => {
    const local = TsujiCache.get<CachedList>(lastKey(userName));
    const server = await readFreshTsujiRawGlobalMeta()
        .then((raw) => parseSavedList(raw as Record<string, string | undefined>, userName))
        .catch(() => null);
    if (server) {
        writeListTitleIndex(userName, { ...server.titleIndex, ...readListTitleIndex(userName) });
    }
    const serverAt = server ? server.at * 1000 : 0;
    if (server && (!local || serverAt > local.fetchedAt)) {
        return { list: server.list, at: serverAt };
    }
    return local ? { list: local.list, at: local.fetchedAt } : null;
};

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
                    savedAt: null,
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
        savedAt: previous?.savedAt ?? null,
    });

    const promise = aniList
        .request<MyListResponse>(MY_LIST_QUERY, { userName }, { timeoutMs: ANILIST_TIMEOUT_MS.fast })
        .then((data) => {
            const list = parseMediaListCollection(data);
            const fetchedAt = Date.now();
            TsujiCache.set(cacheKey(userName), { fetchedAt, list } satisfies CachedList, MY_LIST_TTL_MS);
            TsujiCache.set(lastKey(userName), { fetchedAt, list } satisfies CachedList, LAST_LIST_TTL_MS);
            writeListTitleIndex(userName, parseListTitleIndex(data));

            if (snapshot.userName === userName) {
                setSnapshot({ userName, status: 'ready', list, fetchedAt, failedAt: null, savedAt: null });
            }
        })
        .catch(async (error) => {
            defaultPromiseErrorHandler('loadMyList')(error);
            if (snapshot.userName !== userName) {
                return;
            }
            // A list already in use this session stays. Else a saved copy hides what was read, the newer of the last
            // list AniList gave this browser and the server's copy (brief #17), and says how old it is.
            const saved = snapshot.list ? null : await loadSavedCopy(userName);
            if (snapshot.userName === userName) {
                setSnapshot({
                    ...snapshot,
                    status: 'error',
                    failedAt: Date.now(),
                    ...(saved ? { list: saved.list, fetchedAt: saved.at, savedAt: saved.at } : {}),
                });
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
        /** The list in use is a saved copy (AniList failed), taken then (epoch ms). */
        savedAt: isCurrentUser ? state.savedAt : null,
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

/** The title index of the configured user's list (for cards from Comick), read again when the list changes. */
export const useListTitleIndex = (): ListTitleIndex | null => {
    const { userName, fetchedAt } = useMyAniList();
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => readListTitleIndex(userName), [userName, fetchedAt]);
};
