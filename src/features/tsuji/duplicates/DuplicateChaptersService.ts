/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { requestManager } from '@/lib/requests/RequestManager.ts';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { TsujiChapterCopiesQuery, TsujiChapterCopiesQueryVariables } from '@/lib/graphql/generated/graphql.ts';
import { TSUJI_CHAPTER_COPIES } from '@/features/tsuji/graphql/TsujiQueries.ts';
import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import type { MangaIdInfo } from '@/features/manga/Manga.types.ts';
import { getReaderStore } from '@/features/reader/stores/ReaderStore.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { CopyInfo } from '@/features/tsuji/duplicates/duplicateChapters.ts';
import {
    getIdsWithReadCopies,
    parseReadScanlator,
    tsujiAddDuplicates,
} from '@/features/tsuji/duplicates/duplicateChapters.ts';
import { readTsujiMangaMeta, setTsujiMangaMeta } from '@/features/tsuji/services/TsujiMetadata.ts';

/**
 * Hook for upstream's `Chapters.markAsRead` (every manual "mark as read"): the ids plus the unread copies of the
 * same chapter numbers, from one fresh read of those mangas' chapters. If that read fails, the marking still goes
 * through for the chosen chapters only.
 */
export const withTsujiReadCopies = async (chapterIds: number[]): Promise<number[]> => {
    if (!chapterIds.length) {
        return chapterIds;
    }

    try {
        const { data } = await requestManager.graphQLClient.client.query<
            TsujiChapterCopiesQuery,
            TsujiChapterCopiesQueryVariables
        >({ query: TSUJI_CHAPTER_COPIES, variables: { ids: chapterIds }, fetchPolicy: 'network-only' });

        const mangaChapters = new Map(
            (data?.chapters.nodes ?? []).flatMap(({ manga }) =>
                manga.chapters.nodes.map((chapter) => [chapter.id, chapter]),
            ),
        );
        return getIdsWithReadCopies(chapterIds, [...mangaChapters.values()]);
    } catch (error) {
        defaultPromiseErrorHandler('withTsujiReadCopies')(error);
        return chapterIds;
    }
};

/**
 * The scanlator last finished in the reader for this manga (manga meta, so every device agrees). Takes any manga
 * object: upstream's chapter list types its manga without `meta`, but the manga screen query selects it.
 */
export const getTsujiReadScanlator = (manga: object): string | null | undefined => {
    const holder = manga as Partial<GqlMetaHolder>;
    return holder.meta
        ? parseReadScanlator(readTsujiMangaMeta(holder as GqlMetaHolder, TSUJI_META_KEYS.readScanlator))
        : undefined;
};

const rememberReadScanlator = (
    manga: (MangaIdInfo & GqlMetaHolder) | undefined,
    scanlator: string | null | undefined,
) => {
    if (!manga || scanlator === undefined) {
        return;
    }
    const value = JSON.stringify(scanlator);
    if (readTsujiMangaMeta(manga, TSUJI_META_KEYS.readScanlator) !== value) {
        setTsujiMangaMeta(manga, TSUJI_META_KEYS.readScanlator, value);
    }
};

/**
 * Hook for upstream's reader progress update (`ReaderService.useUpdateChapter`): the chapters the patch goes to
 * (the current one, plus its copies with "Skip duplicate chapters") and, when the patch marks it read, the
 * scanlator the user reads is remembered for the Resume button.
 */
export const getTsujiReaderUpdateChapters = <T extends Pick<CopyInfo, 'id' | 'chapterNumber' | 'scanlator'>>(
    currentChapter: T,
    mangaChapters: T[],
    patch: { isRead?: boolean | null },
    shouldIncludeCopies: boolean,
): T[] => {
    if (patch.isRead) {
        rememberReadScanlator(getReaderStore().manga, currentChapter.scanlator);
    }
    return shouldIncludeCopies ? tsujiAddDuplicates([currentChapter], mangaChapters) : [currentChapter];
};
