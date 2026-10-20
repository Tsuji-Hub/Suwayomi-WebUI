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

export type EndOffer = { kind: 'read'; number: number } | { kind: 'translate'; number: string; url: string } | null;

/**
 * At the end of the newest English chapter: read the next number in the MTL series when it has it, else translate
 * the raw's next chapter when the raw is ahead. Never anything automatic: the reader shows the offer, the user picks.
 */
export const getEndOffer = ({
    isNewestChapter,
    fraction,
    chapterNumber,
    mtlNumbers,
    row,
}: {
    isNewestChapter: boolean;
    fraction: number;
    chapterNumber: number;
    mtlNumbers: Set<number>;
    row: { ahead: number; next: string; tNext: string } | undefined;
}): EndOffer => {
    if (!isNewestChapter || fraction < 0.9 || !(chapterNumber >= 0)) {
        return null;
    }
    const next = Math.floor(chapterNumber) + 1;
    if (mtlNumbers.has(next)) {
        return { kind: 'read', number: next };
    }
    if (row && row.ahead > 0 && row.tNext) {
        return { kind: 'translate', number: row.next, url: row.tNext };
    }
    return null;
};
