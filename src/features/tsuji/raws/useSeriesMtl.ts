/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useMemo } from 'react';
import { create } from 'zustand';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import { FALLBACK_MANGA } from '@/features/manga/Manga.constants.ts';
import { useChapterListOptions } from '@/features/chapter/utils/ChapterList.util.tsx';
import { GET_CHAPTERS_MANGA, GET_CHAPTERS_READER } from '@/lib/graphql/chapter/ChapterQuery.ts';
import type {
    GetChaptersMangaQuery,
    GetChaptersMangaQueryVariables,
    GetChaptersReaderQuery,
} from '@/lib/graphql/generated/graphql.ts';
import { ChapterOrderBy, SortOrder } from '@/lib/graphql/generated/graphql-base.types.ts';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { DAY_MS, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { readTsujiMangaMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { RawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import { getMangaIdFromUrl, parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';
import { useRawFeedRow } from '@/features/tsuji/raws/rawFeed.ts';
import { buildRawChapterMap } from '@/features/tsuji/raws/rawNumbering.ts';
import type { MtlChapterRef } from '@/features/tsuji/raws/mtlEngine.ts';

/*
 * One English series with its raw and MTL (brief #19): which numbers English has in the active scanlator filter,
 * which the raw has (numbering from the raw names), which the MTL series has. Read by the reader card, the chapter
 * list (inline MTL rows, the Missing row, the chapter menu) and the series page.
 */

export type SeriesChapter = GetChaptersMangaQuery['chapters']['nodes'][number];

export type SeriesMtl = {
    enId: number;
    links: RawLinks;
    rawId: number | null;
    mtlId: number | null;
    /** Raw chapters by parsed number. */
    rawByNumber: Map<number, SeriesChapter>;
    /** MTL chapters by number. */
    mtlByNumber: Map<number, SeriesChapter>;
    /** English chapters in the active scanlator filter. */
    english: SeriesChapter[];
    englishNumbers: Set<number>;
    isLoaded: boolean;
};

/** The `/s` / `/req` reference of a raw chapter number, when the meta has the engine and a signature. */
export const getMtlRef = (series: Pick<SeriesMtl, 'links' | 'rawId'>, number: number): MtlChapterRef | null =>
    series.links.raw?.api && series.rawId
        ? { api: series.links.raw.api, rawId: series.rawId, number, req: series.links.raw.req }
        : null;

/** English chapter numbers in the active filter (only the scanlator exclusion counts: a read chapter still exists). */
export const getEnglishInFilter = <T extends { scanlator?: string | null }>(
    chapters: T[],
    excludedScanlators: string[],
) => chapters.filter(({ scanlator }) => !scanlator || !excludedScanlators.includes(scanlator));

const byNumber = (chapters: SeriesChapter[] | undefined) => {
    const map = new Map<number, SeriesChapter>();
    [...(chapters ?? [])]
        .sort((a, b) => a.sourceOrder - b.sourceOrder)
        .forEach((chapter) => {
            if (chapter.chapterNumber >= 0 && !map.has(chapter.chapterNumber)) {
                map.set(chapter.chapterNumber, chapter);
            }
        });
    return map;
};

const PARENT_TTL_MS = 365 * DAY_MS;
const parentKey = (mtlId: number) => `raws:mtlParent:v1:${mtlId}`;
const mtlKey = (enId: number) => `raws:mtlOf:v1:${enId}`;

/** The English series an MTL series translates (this browser only; the meta links English -> MTL, not back). */
export const readMtlParent = (mtlId: number | null | undefined): number | null =>
    mtlId ? TsujiCache.get<number>(parentKey(mtlId)) : null;

/** Remembers MTL <-> English (an MTL id seen in an engine answer before the meta has it). */
export const rememberMtlSeries = (enId: number, mtlId: number) => {
    if (TsujiCache.get<number>(parentKey(mtlId)) !== enId) {
        TsujiCache.set(parentKey(mtlId), enId, PARENT_TTL_MS);
    }
    if (TsujiCache.get<number>(mtlKey(enId)) !== mtlId) {
        TsujiCache.set(mtlKey(enId), mtlId, PARENT_TTL_MS);
    }
};

/**
 * A new MTL chapter isn't in the cached chapter list yet (the reader finds its chapter by source order in it): fetch the
 * list before opening it.
 */
export const refreshMangaChapters = async (mangaId: number): Promise<void> => {
    try {
        await requestManager.getChapters<GetChaptersReaderQuery, GetChaptersMangaQueryVariables>(
            GET_CHAPTERS_READER,
            { condition: { mangaId }, order: [{ by: ChapterOrderBy.SourceOrder, byType: SortOrder.Desc }] },
            { fetchPolicy: 'network-only' },
        ).response;
    } catch {
        // Opening the chapter still works when the list was already current.
    }
};

const useChapters = (mangaId: number | null) =>
    requestManager.useGetMangaChapters<GetChaptersMangaQuery, GetChaptersMangaQueryVariables>(
        GET_CHAPTERS_MANGA,
        mangaId ?? -1,
        { skip: !mangaId },
    ).data?.chapters.nodes;

/** Series by English id, for the chapter rows (they only know their own chapter). */
export const useSeriesMtlStore = create<Record<number, SeriesMtl>>(() => ({}));

/** The MTL ids of the series in the store (inline rows' badge). */
export const isMtlManga = (series: Record<number, SeriesMtl>, mangaId: number) =>
    Object.values(series).some(({ mtlId }) => mtlId === mangaId);

/**
 * The series around an English manga (null = none): its links from meta, raw / MTL / English chapters. `publish`
 * puts it in the store for the chapter rows. Only reads: the raw and MTL chapter lists Suwayomi already has.
 */
export const useSeriesMtl = (
    manga: ({ id: number } & Partial<GqlMetaHolder>) | null | undefined,
    { publish = false }: { publish?: boolean } = {},
): SeriesMtl | null => {
    const hasMeta = !!manga?.meta;
    const links = useMemo(
        () =>
            parseRawLinks(
                manga?.meta ? readTsujiMangaMeta(manga as GqlMetaHolder, TSUJI_META_KEYS.rawLinks) : undefined,
            ),
        [manga],
    );
    const isLinked = !!links.raw || !!links.mtl;
    const enId = isLinked && manga ? manga.id : null;
    const { row } = useRawFeedRow(enId);
    const rawId = links.raw?.mangaId ?? null;
    const mtlId =
        links.mtl?.mangaId ??
        (enId ? TsujiCache.get<number>(mtlKey(enId)) : null) ??
        (row ? getMangaIdFromUrl(row.mtlUrl) : null);
    const options = useChapterListOptions(hasMeta ? (manga as { id: number } & GqlMetaHolder) : FALLBACK_MANGA);

    const englishAll = useChapters(enId);
    const rawChapters = useChapters(rawId);
    const mtlChapters = useChapters(mtlId);

    const series = useMemo((): SeriesMtl | null => {
        if (!enId) {
            return null;
        }
        const english = getEnglishInFilter(englishAll ?? [], options.excludedScanlators);
        return {
            enId,
            links,
            rawId,
            mtlId,
            rawByNumber: rawChapters ? buildRawChapterMap(rawChapters, row?.origin ?? null) : new Map(),
            mtlByNumber: byNumber(mtlChapters),
            english,
            englishNumbers: new Set(english.map(({ chapterNumber }) => chapterNumber)),
            isLoaded: !!englishAll && (!rawId || !!rawChapters),
        };
    }, [enId, links, rawId, mtlId, englishAll, rawChapters, mtlChapters, options.excludedScanlators, row?.origin]);

    useEffect(() => {
        if (series?.mtlId) {
            rememberMtlSeries(series.enId, series.mtlId);
        }
    }, [series?.enId, series?.mtlId]);

    useEffect(() => {
        if (!publish || !series) {
            return undefined;
        }
        useSeriesMtlStore.setState({ [series.enId]: series });
        return () => {
            useSeriesMtlStore.setState((state) => {
                const { [series.enId]: _removed, ...rest } = state;
                return rest;
            }, true);
        };
    }, [publish, series]);

    return series;
};
