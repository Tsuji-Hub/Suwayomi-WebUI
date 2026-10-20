/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { TsujiChapterBellQuery, TsujiChapterBellQueryVariables } from '@/lib/graphql/generated/graphql.ts';
import { DAY_MS, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { TSUJI_CHAPTER_BELL } from '@/features/tsuji/graphql/TsujiQueries.ts';
import {
    readFreshTsujiRawGlobalMeta,
    setTsujiGlobalMeta,
    useTsujiGlobalMetaQuery,
    writeTsujiRawGlobalMeta,
} from '@/features/tsuji/services/TsujiMetadata.ts';
import type { BellChapter, BellEntry, BellManga } from '@/features/tsuji/bell/chapterBell.ts';
import {
    BELL_MAX_CHAPTERS,
    BELL_REFRESH_MS,
    BELL_WINDOW_DAYS,
    buildBellEntries,
    getFirstRunSeen,
    isUnseen,
    parseWatchedCategories,
    planBellWrite,
    readBellWatermarks,
    resolveWatchedCategories,
    toWatermarks,
} from '@/features/tsuji/bell/chapterBell.ts';

let writeQueue: Promise<unknown> = Promise.resolve();

/**
 * Raises watermarks merged into the server's current buckets (one read, one write of the touched buckets), plus
 * any extra keys; serialized so quick successive clicks can't race each other.
 */
const writeWatermarks = (patch: ReadonlyMap<number, number>, extra: [string, string][] = []) => {
    const run = writeQueue.then(async () => {
        const set = [...planBellWrite(await readFreshTsujiRawGlobalMeta(), patch), ...extra];
        if (set.length) {
            await writeTsujiRawGlobalMeta({ set, delete: [] });
        }
    });
    writeQueue = run.catch(() => undefined);
    return run;
};

let isFirstRunStarted = false;

/** The window start, rounded to the day so the query's variables (and Apollo's cache entry) change once a day. */
const getSince = () => {
    const today = Math.floor(Date.now() / DAY_MS) * DAY_MS;
    return String(Math.floor((today - BELL_WINDOW_DAYS * DAY_MS) / 1000));
};

/**
 * The bell's data: one request on mount and every 10 minutes while mounted (skipped while the tab is hidden);
 * reading a chapter anywhere updates Apollo's cache, which clears its entry without a request.
 */
export const useChapterBell = () => {
    const variables = useMemo<TsujiChapterBellQueryVariables>(
        () => ({ since: getSince(), first: BELL_MAX_CHAPTERS }),
        [],
    );
    const { data, error, refetch } = useQuery<TsujiChapterBellQuery, TsujiChapterBellQueryVariables>(
        TSUJI_CHAPTER_BELL,
        {
            client: requestManager.graphQLClient.client,
            variables,
            fetchPolicy: 'cache-first',
            pollInterval: BELL_REFRESH_MS,
            skipPollAttempt: () => document.hidden,
        },
    );
    const { rawMeta, isLoading: isMetaLoading } = useTsujiGlobalMetaQuery();
    // Watermarks written from this tab show at once, whatever the meta query has caught up with.
    const [local, setLocal] = useState<ReadonlyMap<number, number>>(() => new Map());

    const categories = useMemo(
        () => (data?.categories.nodes ?? []).map(({ id, name }) => ({ id, name })),
        [data?.categories.nodes],
    );
    const savedCategories = parseWatchedCategories(rawMeta[TSUJI_META_KEYS.bellCategories]);
    const watchedCategoryIds = useMemo(
        () => resolveWatchedCategories(categories, savedCategories),
        // The saved value is compared as text: the parse makes a new array on every render.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
        [categories, JSON.stringify(savedCategories)],
    );

    const entries = useMemo(() => {
        const nodes = data?.chapters.nodes ?? [];
        const mangas = new Map<number, BellManga>();
        const chapters: BellChapter[] = nodes.map((node) => {
            const { manga } = node;
            mangas.set(manga.id, {
                id: manga.id,
                title: manga.title,
                thumbnailUrl: manga.thumbnailUrl ?? null,
                unreadCount: manga.unreadCount,
                latestReadNumber: manga.latestReadChapter?.chapterNumber ?? null,
                categories: manga.categories.nodes.map(({ id, name }) => ({ id, name })),
            });
            return {
                id: node.id,
                mangaId: node.mangaId,
                chapterNumber: node.chapterNumber,
                fetchedAt: Number(node.fetchedAt),
                sourceOrder: node.sourceOrder,
                isRead: node.isRead,
            };
        });
        return buildBellEntries({ mangas: [...mangas.values()], chapters, watchedCategoryIds });
    }, [data?.chapters.nodes, watchedCategoryIds]);

    const watermarks = useMemo(() => {
        const merged = readBellWatermarks(rawMeta);
        local.forEach((value, mangaId) => merged.set(mangaId, Math.max(merged.get(mangaId) ?? value, value)));
        return merged;
    }, [rawMeta, local]);

    const hasStarted = !!rawMeta[TSUJI_META_KEYS.bellStart];
    const isReady = !!data && !isMetaLoading && (hasStarted || isFirstRunStarted);
    const unseen = useMemo(
        () => (isReady ? entries.filter((entry) => isUnseen(entry, watermarks)) : []),
        [isReady, entries, watermarks],
    );

    const markSeen = useCallback((seen: BellEntry[]) => {
        const patch = toWatermarks(seen);
        setLocal((previous) => new Map([...previous, ...patch]));
        return writeWatermarks(patch).catch(defaultPromiseErrorHandler('useChapterBell::markSeen'));
    }, []);

    // First run after deploy: what is new now counts as unseen, but only the newest 30.
    useEffect(() => {
        if (!data || isMetaLoading || hasStarted || isFirstRunStarted) {
            return;
        }
        isFirstRunStarted = true;
        const patch = getFirstRunSeen(entries);
        setLocal((previous) => new Map([...previous, ...patch]));
        writeWatermarks(patch, [[TSUJI_META_KEYS.bellStart, String(Date.now())]]).catch((failure) => {
            isFirstRunStarted = false;
            defaultPromiseErrorHandler('useChapterBell::firstRun')(failure);
        });
    }, [data, isMetaLoading, hasStarted, entries]);

    const setWatchedCategories = useCallback(
        (ids: number[]) =>
            setTsujiGlobalMeta(TSUJI_META_KEYS.bellCategories, JSON.stringify([...ids].sort((a, b) => a - b))),
        [],
    );

    return {
        unseen,
        categories,
        watchedCategoryIds,
        isLoading: !isReady && !error,
        isError: !!error && !data,
        markSeen,
        setWatchedCategories,
        refresh: refetch,
    };
};
