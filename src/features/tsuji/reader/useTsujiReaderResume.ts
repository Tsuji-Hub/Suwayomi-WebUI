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
import { getReaderPagesStore } from '@/features/reader/stores/ReaderStore.ts';
import { getPageOffset, readPageOffset, writePageOffset } from '@/features/tsuji/reader/pageOffsets.ts';
import { startResumePin } from '@/features/tsuji/reader/resumePin.ts';
import { isResumeSettling, shouldSkipTsujiProgressWrite } from '@/features/tsuji/reader/resumeState.ts';

const getStorage = (): Storage | null => {
    try {
        return window.localStorage;
    } catch {
        return null;
    }
};

const getPagesIndex = (pages: PageData[], pageIndex: number) =>
    pages.findIndex(({ primary }) => primary.index === pageIndex);

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
 * saves the in-page offset of the current chapter while reading.
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

    useEffect(() => {
        const shouldPin =
            !hasStartedRef.current &&
            isInitialChapter &&
            isVertical &&
            resumeMode === ReaderResumeMode.LAST_READ &&
            lastPageRead > 0 &&
            targetPagesIndex >= 0 &&
            !!scrollElement;
        if (!shouldPin) {
            return;
        }

        hasStartedRef.current = true;
        const storage = getStorage();
        stopPinRef.current = startResumePin({
            chapterId,
            pageIndex: lastPageRead,
            offset: storage ? readPageOffset(storage, chapterId, lastPageRead) : 0,
            scrollElement,
            getTargetElement: () => imageRefs.current[targetPagesIndex] ?? null,
        }).stop;
    }, [isInitialChapter, isVertical, resumeMode, lastPageRead, targetPagesIndex, scrollElement, chapterId]);

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
                return;
            }

            const element = imageRefs.current[getPagesIndex(pages, currentPageIndex)];
            if (!element) {
                return;
            }

            const { top, height } = measure(element, scrollElement);
            writePageOffset(storage, chapterId, currentPageIndex, getPageOffset(scrollElement.scrollTop, top, height));
        };
        const onScroll = () => {
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
