/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect } from 'react';
import { getReaderPagesStore } from '@/features/reader/stores/ReaderStore.ts';
import { getChapterPageRefs } from '@/features/tsuji/reader/chapterPagesRegistry.ts';
import { getPageOffset } from '@/features/tsuji/reader/pageOffsets.ts';
import { clearResumeRestore, setResumeRestore } from '@/features/tsuji/reader/resumeState.ts';
import { startResumePin } from '@/features/tsuji/reader/resumePin.ts';

/*
 * A partial MTL chapter (brief #19) is replaced by the full one on the server (10 pages -> 191): the reader fetches
 * the chapter's pages again, without reloading the app, and stays on the page being read.
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

const WAIT_STEP_MS = 100;
const WAIT_LIMIT_MS = 20_000;

/**
 * Fetches the chapter's page list again (the full chapter after the partial one) and keeps the reader where it was:
 * the page and the offset in it. The reader reloads its pages from scratch (its first page, or lastPageRead), so
 * progress writes are held until the new pages are in; then the page is pinned like a resume (continuous vertical) or
 * selected (other modes). False when the chapter isn't shown.
 */
export const refetchChapterPagesInPlace = ({
    chapterId,
    scrollElement,
    isVertical,
}: {
    chapterId: number;
    scrollElement: HTMLElement | null;
    isVertical: boolean;
}): boolean => {
    const fetchPages = fetchers.get(chapterId);
    if (!fetchPages) {
        return false;
    }
    const { currentPageIndex: pageIndex, totalPages } = getReaderPagesStore();
    const refs = getChapterPageRefs(chapterId);
    const before = refs?.current[pageIndex] ?? null;
    const offset = (() => {
        if (!before || !scrollElement) {
            return 0;
        }
        const rect = before.getBoundingClientRect();
        const top = rect.top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop;
        return getPageOffset(scrollElement.scrollTop, top, rect.height);
    })();

    // Until the new pages are in: no lastPageRead write from the reader's reload position.
    let isWaiting = true;
    setResumeRestore({
        chapterId,
        pageIndex,
        isPinActive: () => isWaiting,
        isOffsetPending: () => isWaiting,
        hasUserMoved: false,
    });
    fetchPages();

    const startedAt = Date.now();
    const settle = () => {
        const target = getChapterPageRefs(chapterId)?.current[pageIndex] ?? null;
        const isReloaded =
            !!target?.isConnected &&
            (target !== before || getReaderPagesStore().totalPages !== totalPages) &&
            getReaderPagesStore().pageToScrollToIndex === null;
        if (!isReloaded) {
            if (Date.now() - startedAt < WAIT_LIMIT_MS) {
                setTimeout(settle, WAIT_STEP_MS);
            } else {
                isWaiting = false;
                clearResumeRestore(chapterId);
            }
            return;
        }
        isWaiting = false;
        if (isVertical && scrollElement) {
            startResumePin({
                chapterId,
                pageIndex,
                offset,
                scrollElement,
                getTargetElement: () => getChapterPageRefs(chapterId)?.current[pageIndex] ?? null,
            });
            return;
        }
        clearResumeRestore(chapterId);
        getReaderPagesStore().setPageToScrollToIndex(pageIndex);
    };
    setTimeout(settle, WAIT_STEP_MS);
    return true;
};
