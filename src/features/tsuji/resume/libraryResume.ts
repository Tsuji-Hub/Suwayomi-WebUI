/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { requestManager } from '@/lib/requests/RequestManager.ts';
import { GET_CHAPTERS_MANGA } from '@/lib/graphql/chapter/ChapterQuery.ts';
import { GET_MANGA_META } from '@/lib/graphql/manga/MangaQuery.ts';
import type {
    GetChaptersMangaQuery,
    GetChaptersMangaQueryVariables,
    GetMangaMetaQuery,
    GetMangaMetaQueryVariables,
} from '@/lib/graphql/generated/graphql.ts';
import { ChapterOrderBy, SortOrder } from '@/lib/graphql/generated/graphql-base.types.ts';
import { getMangaMetadata } from '@/features/manga/services/MangaMetadata.ts';
import { getTsujiResumeChapter } from '@/features/tsuji/duplicates/duplicateChapters.ts';
import { getTsujiReadScanlator } from '@/features/tsuji/duplicates/DuplicateChaptersService.ts';

/*
 * The library card's Play button resolves its chapter like the series page's Resume (library Play brief): the chapter
 * list (the query ChapterList makes, cache-first: a visited title costs nothing), the manga's meta (the read scanlator,
 * the excluded scanlators) and `getTsujiResumeChapter`, so a series read in its unofficial copy resumes there. Loaded
 * on hover / focus / click only, never with the library.
 */

export type LibraryResumeChapter = GetChaptersMangaQuery['chapters']['nodes'][number];

/** `chapter`: where to resume; null: every chapter has a read copy (open the series); `error`: use the server's. */
export type LibraryResume = { chapter: LibraryResumeChapter | null } | 'error';

const inFlight = new Map<number, Promise<LibraryResume>>();

const load = async (mangaId: number): Promise<LibraryResume> => {
    try {
        const [chapters, meta] = await Promise.all([
            requestManager.getChapters<GetChaptersMangaQuery, GetChaptersMangaQueryVariables>(
                GET_CHAPTERS_MANGA,
                {
                    condition: { mangaId },
                    order: [{ by: ChapterOrderBy.SourceOrder, byType: SortOrder.Desc }],
                },
                { fetchPolicy: 'cache-first' },
            ).response,
            requestManager.getManga<GetMangaMetaQuery, GetMangaMetaQueryVariables>(GET_MANGA_META, mangaId, {
                fetchPolicy: 'cache-first',
            }).response,
        ]);
        const nodes = chapters.data?.chapters.nodes;
        const manga = meta.data?.manga;
        if (!nodes || !manga) {
            return 'error';
        }
        const { excludedScanlators } = getMangaMetadata(manga);
        return {
            chapter: getTsujiResumeChapter(nodes, null, getTsujiReadScanlator(manga), excludedScanlators),
        };
    } catch {
        return 'error';
    }
};

/** One resolution at a time per title; a later hover resolves again (from Apollo's cache, so reads made since count). */
export const loadLibraryResume = (mangaId: number): Promise<LibraryResume> => {
    const pending = inFlight.get(mangaId);
    if (pending) {
        return pending;
    }
    const resume = load(mangaId).finally(() => inFlight.delete(mangaId));
    inFlight.set(mangaId, resume);
    return resume;
};
