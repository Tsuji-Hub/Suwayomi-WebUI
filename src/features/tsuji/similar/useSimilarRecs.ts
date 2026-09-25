/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { GET_MANGA_TRACK_RECORDS } from '@/lib/graphql/manga/MangaQuery.ts';
import type { GetMangaTrackRecordsQuery } from '@/lib/graphql/generated/graphql.ts';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import type { MangaIdInfo, MangaTitleInfo } from '@/features/manga/Manga.types.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { TRACKER_ID, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { TrackRecordRef } from '@/features/tsuji/recs/resolveAniListId.ts';
import { resolveAniListId } from '@/features/tsuji/recs/resolveAniListId.ts';
import type { SimilarData } from '@/features/tsuji/similar/SimilarService.ts';
import { loadSimilar } from '@/features/tsuji/similar/SimilarService.ts';
import { readTsujiMangaMeta, setTsujiMangaMeta } from '@/features/tsuji/services/TsujiMetadata.ts';

export type SimilarManga = MangaIdInfo & MangaTitleInfo & GqlMetaHolder;

export type SimilarState =
    | { status: 'loading' }
    | { status: 'no-match' }
    | { status: 'error' }
    | { status: 'ready'; data: SimilarData };

const LOADING: SimilarState = { status: 'loading' };

const getRemoteId = (records: TrackRecordRef[] | undefined, trackerId: number) =>
    records?.find((record) => record.trackerId === trackerId)?.remoteId ?? '';

/**
 * Resolves the series' AniList id and loads merged recommendations. Never blocks the page: the caller renders a
 * skeleton while `loading`. Reloads only when the manga or its AniList/MAL tracker ids change (not on every tracker
 * edit), and aborts the previous load when that happens or the section unmounts.
 */
export const useSimilarRecs = (manga: SimilarManga) => {
    const [result, setResult] = useState<{ mangaId: number; state: SimilarState }>({
        mangaId: manga.id,
        state: LOADING,
    });
    const [reloadCount, setReloadCount] = useState(0);
    const shouldForceRef = useRef(false);

    const trackRecordsQuery = requestManager.useGetManga<GetMangaTrackRecordsQuery>(GET_MANGA_TRACK_RECORDS, manga.id);
    const trackRecords = trackRecordsQuery.data?.manga.trackRecords.nodes;
    const isTrackRecordsSettled = !!trackRecords || !!trackRecordsQuery.error;
    const anilistRemoteId = getRemoteId(trackRecords, TRACKER_ID.ANILIST);
    const malRemoteId = getRemoteId(trackRecords, TRACKER_ID.MAL);

    // Latest manga (its meta changes after the id is persisted) without re-running the load.
    const mangaRef = useRef(manga);
    mangaRef.current = manga;

    useEffect(() => {
        if (!isTrackRecordsSettled) {
            return undefined;
        }

        const controller = new AbortController();
        const { signal } = controller;
        const currentManga = mangaRef.current;
        const force = shouldForceRef.current;
        shouldForceRef.current = false;

        const publish = (state: SimilarState) => {
            signal.throwIfAborted();
            setResult({ mangaId: currentManga.id, state });
        };

        const load = async () => {
            publish(LOADING);

            const resolved = await resolveAniListId({
                mangaId: currentManga.id,
                title: currentManga.title,
                trackRecords: [
                    { trackerId: TRACKER_ID.ANILIST, remoteId: anilistRemoteId },
                    { trackerId: TRACKER_ID.MAL, remoteId: malRemoteId },
                ],
                cachedId: readTsujiMangaMeta(currentManga, TSUJI_META_KEYS.anilistId),
                force,
                signal,
            });

            if (!resolved) {
                publish({ status: 'no-match' });
                return;
            }

            if (resolved.shouldPersist) {
                setTsujiMangaMeta(currentManga, TSUJI_META_KEYS.anilistId, String(resolved.id));
            }

            const data = await loadSimilar({ anilistId: resolved.id, force, signal });
            publish({ status: 'ready', data });
        };

        load().catch((error) => {
            if (signal.aborted) {
                return;
            }

            defaultPromiseErrorHandler('useSimilarRecs')(error);
            setResult({ mangaId: currentManga.id, state: { status: 'error' } });
        });

        return () => controller.abort();
    }, [manga.id, isTrackRecordsSettled, anilistRemoteId, malRemoteId, reloadCount]);

    const retry = useCallback(() => setReloadCount((count) => count + 1), []);
    const refresh = useCallback(() => {
        shouldForceRef.current = true;
        setReloadCount((count) => count + 1);
    }, []);

    // A result for another manga (navigated away before it resolved) never shows here.
    const state = result.mangaId === manga.id ? result.state : LOADING;

    return { state, retry, refresh };
};
