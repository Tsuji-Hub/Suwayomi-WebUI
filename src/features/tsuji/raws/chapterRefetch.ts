/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect } from 'react';

/*
 * A partial MTL chapter (brief #19) is replaced by the full one on the server (10 pages -> 191): the reader fetches
 * the chapter's pages again, without reloading the app, and resumes at the page last read.
 */

type FetchPages = () => void;

const fetchers = new Map<number, FetchPages>();

/** Upstream hook (ReaderChapterViewer): lets the raws layer refetch this chapter's pages. */
export const useTsujiChapterRefetch = (chapterId: number | undefined, fetchPages: FetchPages) => {
    useEffect(() => {
        if (!chapterId) {
            return undefined;
        }
        fetchers.set(chapterId, fetchPages);
        return () => {
            if (fetchers.get(chapterId) === fetchPages) {
                fetchers.delete(chapterId);
            }
        };
    }, [chapterId, fetchPages]);
};

/** Fetches the chapter's page list again (no-op when it isn't shown). */
export const refetchChapterPages = (chapterId: number): boolean => {
    const fetchPages = fetchers.get(chapterId);
    fetchPages?.();
    return !!fetchPages;
};
