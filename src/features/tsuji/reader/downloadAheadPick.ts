/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export type AheadChapter = { id: number; isRead: boolean; isDownloaded: boolean };

/**
 * Which chapters to download ahead: the next `limit` unread chapters (`nextChapters` is latest first, like the
 * reader's list) that aren't downloaded or downloading yet, once the reader is past 25 % of the current chapter.
 *
 * Upstream (the Mihon rule) only downloads ahead when the current AND the next chapter are already downloaded, so
 * with delete-while-reading one failed download stops the chain for good (0 chapters were downloaded across the
 * owner's library). Here the chain never depends on what is already on disk.
 */
export const pickDownloadAheadIds = ({
    currentPageIndex,
    pageCount,
    nextChapters,
    limit,
    isDownloading,
}: {
    currentPageIndex: number;
    pageCount: number;
    nextChapters: AheadChapter[];
    limit: number;
    isDownloading: (id: number) => boolean;
}): number[] => {
    // Upstream's isInDownloadAheadRange (next direction): past 25 % of the current chapter.
    const isPastQuarter = (currentPageIndex + 1) / pageCount > 0.25;
    if (limit <= 0 || !nextChapters.length || !isPastQuarter) {
        return [];
    }

    return nextChapters
        .filter(({ isRead }) => !isRead)
        .slice(-limit)
        .filter(({ id, isDownloaded }) => !isDownloaded && !isDownloading(id))
        .map(({ id }) => id);
};
