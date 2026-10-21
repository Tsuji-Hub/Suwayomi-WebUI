/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@apollo/client/react';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type {
    TsujiBellChaptersQuery,
    TsujiBellChaptersQueryVariables,
    TsujiBellSeriesQuery,
    TsujiBellSeriesQueryVariables,
} from '@/lib/graphql/generated/graphql.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { TSUJI_BELL_CHAPTERS, TSUJI_BELL_SERIES } from '@/features/tsuji/graphql/TsujiQueries.ts';
import {
    readFreshTsujiRawGlobalMeta,
    setTsujiGlobalMeta,
    useTsujiGlobalMetaQuery,
    writeTsujiRawGlobalMeta,
} from '@/features/tsuji/services/TsujiMetadata.ts';
import type { BellChapter, BellEntry, BellManga } from '@/features/tsuji/bell/chapterBell.ts';
import {
    BELL_CHAPTER_BATCH,
    BELL_MAX_SERIES,
    BELL_REFRESH_MS,
    buildBellEntries,
    DEFAULT_WATCHED_CATEGORY_NAMES,
    getFirstRunSeen,
    isUnseen,
    parseWatchedCategories,
    pickBellSeries,
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

const BATCH_SLOTS = Math.ceil(BELL_MAX_SERIES / BELL_CHAPTER_BATCH);

/**
 * The series request's last answer, kept outside Apollo's normalized cache: it nests the series under their
 * categories, a field Suwayomi's own library queries write too, and sharing it made the two refetch each other.
 * Reused for 10 minutes (the bell remounts after the reader) and per filter.
 */
const seriesStore: { key: string; at: number; data: TsujiBellSeriesQuery | null } = { key: '', at: 0, data: null };

const fetchSeries = async (variables: TsujiBellSeriesQueryVariables, force: boolean) => {
    const key = JSON.stringify(variables);
    if (!force && seriesStore.key === key && seriesStore.data && Date.now() - seriesStore.at < BELL_REFRESH_MS) {
        return seriesStore.data;
    }
    const { data } = await requestManager.graphQLClient.client.query<
        TsujiBellSeriesQuery,
        TsujiBellSeriesQueryVariables
    >({ query: TSUJI_BELL_SERIES, variables, fetchPolicy: 'no-cache' });
    if (!data) {
        throw new Error('No answer for the bell series');
    }
    Object.assign(seriesStore, { key, at: Date.now(), data });
    return data;
};

/** One chapters request (up to 60 series); waits for the previous one, so they go out one after another. */
const useChapterBatch = (mangaIds: number[] | undefined, isTurn: boolean) =>
    useQuery<TsujiBellChaptersQuery, TsujiBellChaptersQueryVariables>(TSUJI_BELL_CHAPTERS, {
        client: requestManager.graphQLClient.client,
        variables: { mangaIds: mangaIds ?? [] },
        skip: !mangaIds?.length || !isTurn,
        fetchPolicy: 'cache-first',
    });

/**
 * The bell's data (brief #12): the watched categories' series in one request, then the chapters of those with
 * something unread (at most 300) in requests of 60 series, one after another. On mount and every 10 minutes while
 * mounted (skipped while the tab is hidden); reading a chapter anywhere updates Apollo's cache, which updates the
 * entries without a request.
 */
export const useChapterBell = () => {
    const { rawMeta, isLoading: isMetaLoading } = useTsujiGlobalMetaQuery();
    // Watermarks written from this tab show at once, whatever the meta query has caught up with.
    const [local, setLocal] = useState<ReadonlyMap<number, number>>(() => new Map());
    const savedCategories = parseWatchedCategories(rawMeta[TSUJI_META_KEYS.bellCategories]);
    const savedKey = JSON.stringify(savedCategories);
    const seriesVariables = useMemo<TsujiBellSeriesQueryVariables>(() => {
        const saved = JSON.parse(savedKey) as number[] | null;
        return {
            filter: saved ? { id: { in: saved } } : { name: { inInsensitive: DEFAULT_WATCHED_CATEGORY_NAMES } },
        };
    }, [savedKey]);
    const seriesKey = JSON.stringify(seriesVariables);
    const [seriesState, setSeriesState] = useState<{
        key: string;
        data: TsujiBellSeriesQuery | null;
        error: unknown;
    }>(() => ({ key: seriesStore.key, data: seriesStore.data, error: null }));
    const loadSeries = useCallback(
        async (force: boolean) => {
            try {
                const answer = await fetchSeries(seriesVariables, force);
                setSeriesState({ key: seriesKey, data: answer, error: null });
            } catch (failure) {
                setSeriesState((previous) => ({ ...previous, key: seriesKey, error: failure }));
                throw failure;
            }
        },
        [seriesVariables, seriesKey],
    );
    useEffect(() => {
        if (!isMetaLoading) {
            loadSeries(false).catch(defaultPromiseErrorHandler('useChapterBell::series'));
        }
    }, [isMetaLoading, loadSeries]);
    const data = seriesState.key === seriesKey ? seriesState.data : null;
    const error = seriesState.key === seriesKey ? seriesState.error : null;

    const categories = useMemo(
        () => (data?.categories.nodes ?? []).map(({ id, name }) => ({ id, name })),
        [data?.categories.nodes],
    );
    const watchedCategoryIds = useMemo(
        () => resolveWatchedCategories(categories, JSON.parse(savedKey) as number[] | null),
        [categories, savedKey],
    );

    const series = useMemo(
        () =>
            pickBellSeries(
                (data?.watched.nodes ?? []).flatMap(({ name, mangas }) =>
                    mangas.nodes.map(
                        (manga): BellManga => ({
                            id: manga.id,
                            title: manga.title,
                            thumbnailUrl: manga.thumbnailUrl ?? null,
                            category: name,
                            inLibrary: manga.inLibrary,
                            inLibraryAt: Number(manga.inLibraryAt),
                            unreadCount: manga.unreadCount,
                            lastReadAt: Number(manga.lastReadChapter?.lastReadAt ?? 0),
                            latestFetchedAt: Number(manga.latestFetchedChapter?.fetchedAt ?? 0),
                        }),
                    ),
                ),
            ),
        [data?.watched.nodes],
    );
    const batches = useMemo(
        () =>
            Array.from({ length: BATCH_SLOTS }, (_, index) =>
                series.slice(index * BELL_CHAPTER_BATCH, (index + 1) * BELL_CHAPTER_BATCH).map(({ id }) => id),
            ).map((ids) => (ids.length ? ids : undefined)),
        [series],
    );
    // A fixed number of slots (300 / 60), each waiting for the one before.
    const slot0 = useChapterBatch(batches[0], !!data);
    const slot1 = useChapterBatch(batches[1], !!slot0.data);
    const slot2 = useChapterBatch(batches[2], !!slot1.data);
    const slot3 = useChapterBatch(batches[3], !!slot2.data);
    const slot4 = useChapterBatch(batches[4], !!slot3.data);
    const slots = [slot0, slot1, slot2, slot3, slot4];
    const isChaptersLoaded = slots.every((slot, index) => !batches[index] || !!slot.data);
    const chaptersError = slots.find((slot) => slot.error)?.error;

    const slotData = slots.map((slot) => slot.data);
    const entries = useMemo(() => {
        const chapters: BellChapter[] = slotData.flatMap((batch) =>
            (batch?.chapters.nodes ?? []).map((node) => ({
                id: node.id,
                mangaId: node.mangaId,
                chapterNumber: node.chapterNumber,
                fetchedAt: Number(node.fetchedAt),
                sourceOrder: node.sourceOrder,
                isRead: node.isRead,
            })),
        );
        return buildBellEntries(series, chapters);
        // The slots' data objects are stable between renders (Apollo results).
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [series, ...slotData]);

    const refresh = useCallback(async () => {
        await loadSeries(true);
        for (const slot of slots) {
            if (slot.data) {
                // oxlint-disable-next-line no-await-in-loop
                await slot.refetch();
            }
        }
        // The slots are re-created each render; the latest ones are read when the timer fires.
        // oxlint-disable-next-line react-hooks/exhaustive-deps
    }, [loadSeries, ...slots.map((slot) => slot.refetch), ...slotData]);
    const refreshRef = useRef(refresh);
    refreshRef.current = refresh;
    useEffect(() => {
        const timer = setInterval(() => {
            if (!document.hidden) {
                refreshRef.current().catch(defaultPromiseErrorHandler('useChapterBell::refresh'));
            }
        }, BELL_REFRESH_MS);
        return () => clearInterval(timer);
    }, []);

    const watermarks = useMemo(() => {
        const merged = readBellWatermarks(rawMeta);
        local.forEach((value, mangaId) => merged.set(mangaId, Math.max(merged.get(mangaId) ?? value, value)));
        return merged;
    }, [rawMeta, local]);

    const hasStarted = !!rawMeta[TSUJI_META_KEYS.bellStart];
    const isLoaded = !!data && isChaptersLoaded && !isMetaLoading;
    const isReady = isLoaded && (hasStarted || isFirstRunStarted);
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
        if (!isLoaded || hasStarted || isFirstRunStarted) {
            return;
        }
        isFirstRunStarted = true;
        const patch = getFirstRunSeen(entries);
        setLocal((previous) => new Map([...previous, ...patch]));
        writeWatermarks(patch, [[TSUJI_META_KEYS.bellStart, String(Date.now())]]).catch((failure) => {
            isFirstRunStarted = false;
            defaultPromiseErrorHandler('useChapterBell::firstRun')(failure);
        });
    }, [isLoaded, hasStarted, entries]);

    const setWatchedCategories = useCallback(
        (ids: number[]) =>
            setTsujiGlobalMeta(TSUJI_META_KEYS.bellCategories, JSON.stringify([...ids].sort((a, b) => a - b))),
        [],
    );

    return {
        unseen,
        categories,
        watchedCategoryIds,
        isLoading: !isReady && !error && !chaptersError,
        isError: (!!error && !data) || (!!chaptersError && !isChaptersLoaded),
        markSeen,
        setWatchedCategories,
        refresh,
    };
};
