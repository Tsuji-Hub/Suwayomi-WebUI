/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { MutableRefObject } from 'react';

/**
 * The page elements of each chapter the reader has rendered (registered by useTsujiReaderResume), so fork code can
 * measure a chapter inside the scroll element (Compare follows the current chapter's scroll fraction).
 */
const chapterPages = new Map<number, MutableRefObject<(HTMLElement | null)[]>>();

export const registerChapterPages = (chapterId: number, imageRefs: MutableRefObject<(HTMLElement | null)[]>) => {
    chapterPages.set(chapterId, imageRefs);
    return () => {
        if (chapterPages.get(chapterId) === imageRefs) {
            chapterPages.delete(chapterId);
        }
    };
};

/** The chapter's page elements (by pages index), when it is rendered. */
export const getChapterPageRefs = (chapterId: number): MutableRefObject<(HTMLElement | null)[]> | null =>
    chapterPages.get(chapterId) ?? null;

/** Top and bottom of the chapter's rendered pages in the scroll element's content coordinates, or null. */
export const measureChapter = (
    chapterId: number,
    scrollElement: HTMLElement,
): { top: number; bottom: number } | null => {
    const elements = (chapterPages.get(chapterId)?.current ?? []).filter(
        (element): element is HTMLElement => !!element && element.isConnected,
    );
    if (!elements.length) {
        return null;
    }
    const origin = scrollElement.getBoundingClientRect().top - scrollElement.scrollTop;
    const rects = elements.map((element) => element.getBoundingClientRect()).filter((rect) => rect.height > 0);
    if (!rects.length) {
        return null;
    }
    return {
        top: Math.min(...rects.map((rect) => rect.top)) - origin,
        bottom: Math.max(...rects.map((rect) => rect.bottom)) - origin,
    };
};
