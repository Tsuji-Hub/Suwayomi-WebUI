/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { TChapterReader } from '@/features/chapter/Chapter.types.ts';
import { Chapters } from '@/features/chapter/services/Chapters.ts';
import { getReaderChapterFromCache } from '@/features/reader/Reader.utils.ts';
import { pickDownloadAheadIds } from '@/features/tsuji/reader/downloadAheadPick.ts';

/**
 * Hook for upstream's `ReaderService.downloadAhead` (same signature as `getChapterIdsForDownloadAhead`), reading
 * the chapters' current state from the Apollo cache like upstream does.
 */
export const getTsujiChapterIdsForDownloadAhead = (
    chapter: TChapterReader,
    nextChapter: TChapterReader | undefined,
    nextChapters: TChapterReader[],
    currentPageIndex: number,
    downloadAheadLimit: number,
): TChapterReader['id'][] => {
    const current = getReaderChapterFromCache(chapter.id);
    if (!current || !nextChapter) {
        return [];
    }

    return pickDownloadAheadIds({
        currentPageIndex,
        pageCount: current.pageCount,
        nextChapters: nextChapters.map(({ id }) => getReaderChapterFromCache(id)).filter((upToDate) => !!upToDate),
        limit: downloadAheadLimit,
        isDownloading: (id) => Chapters.isDownloading(id),
    });
};
