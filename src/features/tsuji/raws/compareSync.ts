/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Compare: the raw pane follows the English chapter by the fraction of the chapter scrolled, not by page index
 * (English aggregators stitch pages, so page counts differ a lot). 0 = chapter top at the viewport top, 1 = chapter
 * bottom at the viewport bottom, on both sides.
 */

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

export const getChapterFraction = ({
    scrollTop,
    viewportHeight,
    chapterTop,
    chapterBottom,
}: {
    scrollTop: number;
    viewportHeight: number;
    chapterTop: number;
    chapterBottom: number;
}): number => {
    const range = chapterBottom - chapterTop - viewportHeight;
    if (range <= 0) {
        return scrollTop >= chapterTop ? 1 : 0;
    }
    return clamp01((scrollTop - chapterTop) / range);
};

export const getPaneScrollTop = (fraction: number, scrollHeight: number, clientHeight: number): number =>
    Math.round(clamp01(fraction) * Math.max(0, scrollHeight - clientHeight));
