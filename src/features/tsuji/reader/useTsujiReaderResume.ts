/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { MutableRefObject } from 'react';
import { useEffect, useRef } from 'react';
import type { PageData, ReadingMode } from '@/features/reader/Reader.types.ts';
import { ReaderResumeMode } from '@/features/reader/Reader.types.ts';
import { isContinuousVerticalReadingMode } from '@/features/reader/settings/ReaderSettings.utils.tsx';
import { getReaderPagesStore, useReaderPagesStore } from '@/features/reader/stores/ReaderStore.ts';
import {
    getPageOffset,
    getResumeSpot,
    isReaderOwnPosition,
    writePageOffset,
} from '@/features/tsuji/reader/pageOffsets.ts';
import { startResumePin } from '@/features/tsuji/reader/resumePin.ts';
import { markTsujiReading } from '@/features/tsuji/reader/routeResumeMode.ts';
import {
    describeResumeRestore,
    hasTsujiReaderUserInput,
    isResumeSettling,
    isTsujiReloadOf,
    shouldSkipTsujiProgressWrite,
} from '@/features/tsuji/reader/resumeState.ts';

const getStorage = (): Storage | null => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const getPagesIndex = (pages: PageData[], pageIndex: number) =>
    pages.findIndex(({ primary }) => primary.index === pageIndex);

type SkipReason = 'restoring' | 'noPage' | 'readerPosition';

/**
 * Readout for checks on a real browser (`window.tsujiReaderResume` in the console): why offsets were or weren't
 * saved in this page load. `scrollEvents` counts what reached the saver; every save attempt (one per frame) ends up
 * in `saved`, `failed` or `skipped`, so scroll events without attempts mean no animation frames ran.
 */
const saverStats = {
    scrollEvents: 0,
    saved: 0,
    failed: 0,
    lastError: null as string | null,
    last: null as [chapterId: number, pageIndex: number, offset: number] | null,
    skipped: { restoring: 0, noPage: 0, readerPosition: 0 } satisfies Record<SkipReason, number>,
    get hasUserInput() {
        return hasTsujiReaderUserInput();
    },
    get restore() {
        return describeResumeRestore();
    },
};

try {
    Object.defineProperty(window, 'tsujiReaderResume', { value: saverStats, configurable: true });
} catch {
    // Readout only.
}

const countSkip = (reason: SkipReason) => {
    saverStats.skipped[reason] += 1;
};

const recordSave = (
    { isWritten, error }: ReturnType<typeof writePageOffset>,
    entry: [chapterId: number, pageIndex: number, offset: number],
) => {
    if (isWritten) {
        saverStats.saved += 1;
        saverStats.last = entry;
        return;
    }
    saverStats.failed += 1;
    saverStats.lastError = error;
};

/** Scroll-coordinate top and height of a page element inside the scroll element. */
const measure = (element: HTMLElement, scrollElement: HTMLElement) => {
    const rect = element.getBoundingClientRect();
    return {
        top: rect.top - scrollElement.getBoundingClientRect().top + scrollElement.scrollTop,
        height: rect.height,
    };
};

/**
 * Exact resume for the continuous vertical reader (mounted from upstream's ReaderChapterViewer, one line):
 * pins the initial chapter's lastPageRead (+ saved in-page offset) until the layout settles or the user moves, and
 * saves the in-page offset of the current chapter while the user reads.
 *
 * The pin starts once upstream has done its own initial scroll to the page (pageToScrollToIndex consumed), so it
 * refines that position instead of racing it. On a reload while reading it resumes at this tab's saved spot (see
 * getResumeSpot). Nothing is saved while the restore runs, nor a page top the reader scrolled to by itself before the
 * user's first input (see isReaderOwnPosition); any other position is the user's and is saved.
 */
export const useTsujiReaderResume = ({
    chapterId,
    lastPageRead,
    resumeMode,
    readingMode,
    isInitialChapter,
    isCurrentChapter,
    pages,
    imageRefs,
    scrollElement,
}: {
    chapterId: number;
    lastPageRead: number;
    resumeMode: ReaderResumeMode;
    readingMode: ReadingMode;
    isInitialChapter: boolean;
    isCurrentChapter: boolean;
    pages: PageData[];
    imageRefs: MutableRefObject<(HTMLElement | null)[]>;
    scrollElement: HTMLElement | null;
}) => {
    const isVertical = isContinuousVerticalReadingMode(readingMode);
    const targetPagesIndex = getPagesIndex(pages, lastPageRead);
    const stopPinRef = useRef<(() => void) | null>(null);
    const hasStartedRef = useRef(false);
    // Only the initial chapter, until its pin starts, re-renders on upstream's scroll requests.
    const isUpstreamScrollPending = useReaderPagesStore(
        (state) => isInitialChapter && !hasStartedRef.current && state.pageToScrollToIndex !== null,
    );

    useEffect(() => {
        const canPin =
            !hasStartedRef.current &&
            isInitialChapter &&
            isVertical &&
            resumeMode === ReaderResumeMode.LAST_READ &&
            targetPagesIndex >= 0 &&
            !isUpstreamScrollPending &&
            !!scrollElement;
        if (!canPin) {
            return;
        }

        hasStartedRef.current = true;
        // No saved offset for lastPageRead: its page top.
        const spot = getResumeSpot(getStorage(), chapterId, lastPageRead, isTsujiReloadOf(chapterId));
        const spotPagesIndex = getPagesIndex(pages, spot[0]);
        const [pageIndex, offset] = spotPagesIndex >= 0 ? spot : [lastPageRead, 0];
        if (pageIndex === 0 && offset === 0) {
            return;
        }

        const pinPagesIndex = spotPagesIndex >= 0 ? spotPagesIndex : targetPagesIndex;
        stopPinRef.current = startResumePin({
            chapterId,
            pageIndex,
            offset,
            scrollElement,
            getTargetElement: () => imageRefs.current[pinPagesIndex] ?? null,
        }).stop;
    }, [
        isInitialChapter,
        isVertical,
        resumeMode,
        lastPageRead,
        targetPagesIndex,
        isUpstreamScrollPending,
        scrollElement,
        chapterId,
        pages,
    ]);

    useEffect(
        () => () => {
            stopPinRef.current?.();
            stopPinRef.current = null;
            hasStartedRef.current = false;
        },
        [],
    );

    useEffect(() => {
        const storage = getStorage();
        if (!isCurrentChapter || !isVertical || !scrollElement || !storage) {
            return () => {};
        }

        let frame: number | null = null;
        const save = () => {
            frame = null;
            const { currentPageIndex } = getReaderPagesStore();
            if (isResumeSettling(chapterId) || shouldSkipTsujiProgressWrite(chapterId, currentPageIndex)) {
                countSkip('restoring');
                return;
            }

            const element = imageRefs.current[getPagesIndex(pages, currentPageIndex)];
            if (!element) {
                countSkip('noPage');
                return;
            }

            const { top, height } = measure(element, scrollElement);
            if (isReaderOwnPosition(hasTsujiReaderUserInput(), scrollElement.scrollTop, top)) {
                countSkip('readerPosition');
                return;
            }

            const offset = getPageOffset(scrollElement.scrollTop, top, height);
            const result = writePageOffset(storage, chapterId, currentPageIndex, offset);
            recordSave(result, [chapterId, currentPageIndex, offset]);
            if (result.isWritten) {
                markTsujiReading(chapterId);
            }
        };
        const onScroll = () => {
            saverStats.scrollEvents += 1;
            frame ??= requestAnimationFrame(save);
        };

        scrollElement.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            scrollElement.removeEventListener('scroll', onScroll);
            if (frame !== null) {
                cancelAnimationFrame(frame);
            }
        };
    }, [isCurrentChapter, isVertical, scrollElement, chapterId, pages]);
};
