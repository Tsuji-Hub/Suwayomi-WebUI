/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { RECS_CACHE_TTL_MS, TRACKER_ID } from '@/features/tsuji/Tsuji.constants.ts';
import type { ByMalResponse, SearchResponse } from '@/features/tsuji/recs/aniListQueries.ts';
import { BY_MAL_QUERY, SEARCH_QUERY } from '@/features/tsuji/recs/aniListQueries.ts';
import { findExactTitleMatch } from '@/features/tsuji/recs/normalize.ts';
import { aniList, AniListError, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';

export type TrackRecordRef = { trackerId: number; remoteId: string };

export type ResolvedAniListId = {
    id: number;
    /** Found by MAL lookup or title search: worth caching in manga meta. */
    shouldPersist: boolean;
};

const toId = (value: string | number | null | undefined): number | null => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const missKey = (mangaId: number) => `anilistMiss:${mangaId}`;

const isNotFound = (error: unknown) => error instanceof AniListError && error.status === 404;

const lookupByMalId = async (idMal: number, signal: AbortSignal): Promise<number | null> => {
    try {
        const { Media } = await aniList.request<ByMalResponse>(
            BY_MAL_QUERY,
            { idMal },
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        );
        return toId(Media?.id);
    } catch (error) {
        if (isNotFound(error)) {
            return null;
        }
        throw error;
    }
};

/** `hasResults` separates "AniList has no such title" from "AniList returned nothing" (degraded mode). */
const searchByTitle = async (
    title: string,
    signal: AbortSignal,
): Promise<{ id: number | null; hasResults: boolean }> => {
    const { Page } = await aniList.request<SearchResponse>(
        SEARCH_QUERY,
        { search: title },
        { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
    );
    const media = Page?.media ?? [];

    const id = findExactTitleMatch(
        title,
        media.map((entry) => ({
            id: entry.id,
            titles: [
                entry.title?.english,
                entry.title?.romaji,
                entry.title?.userPreferred,
                entry.title?.native,
                ...(entry.synonyms ?? []),
            ],
        })),
    );

    return { id, hasResults: media.length > 0 };
};

/**
 * AniList tracker -> cached manga meta -> MAL tracker (Media(idMal)) -> title search accepting only an exact
 * normalized title/synonym match. A miss is cached for the recs TTL only when the search returned results and none
 * matched. `force` (the Refresh button) skips the saved id and the cached miss and resolves again.
 */
export const resolveAniListId = async ({
    mangaId,
    title,
    trackRecords,
    cachedId,
    force = false,
    signal,
}: {
    mangaId: number;
    title: string;
    trackRecords: TrackRecordRef[];
    cachedId: string | undefined;
    force?: boolean;
    signal: AbortSignal;
}): Promise<ResolvedAniListId | null> => {
    const trackedId = toId(trackRecords.find(({ trackerId }) => trackerId === TRACKER_ID.ANILIST)?.remoteId);
    if (trackedId) {
        return { id: trackedId, shouldPersist: false };
    }

    const metaId = force ? null : toId(cachedId);
    if (metaId) {
        return { id: metaId, shouldPersist: false };
    }

    if (!force && TsujiCache.get<boolean>(missKey(mangaId))) {
        return null;
    }

    const malId = toId(trackRecords.find(({ trackerId }) => trackerId === TRACKER_ID.MAL)?.remoteId);
    const malResolvedId = malId ? await lookupByMalId(malId, signal) : null;
    if (malResolvedId) {
        return { id: malResolvedId, shouldPersist: malResolvedId !== toId(cachedId) };
    }

    const search = await searchByTitle(title, signal);
    signal.throwIfAborted();

    if (!search.id) {
        if (search.hasResults) {
            TsujiCache.set(missKey(mangaId), true, RECS_CACHE_TTL_MS);
        }
        return null;
    }

    return { id: search.id, shouldPersist: search.id !== toId(cachedId) };
};
