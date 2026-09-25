/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/** Chapter numbers below 0 mean "unknown" (Tachiyomi convention, see Chapters.getGap). */
const isKnownNumber = (value: number | null | undefined): value is number =>
    typeof value === 'number' && Number.isFinite(value) && value >= 0;

const roundChapterNumber = (value: number): number => Number.parseFloat(value.toFixed(3));

/** 200.0 -> "200", 20.5 stays "20.5". */
export const formatChapterNumber = (value: number): string => String(roundChapterNumber(value));

export type SeriesProgress = { read: number; total: number | null };

/**
 * Library/series progress: furthest read chapter number over the highest chapter number, falling back to the
 * chapter count only when no chapter numbers exist. Returns null when nothing (numbered above 0) has been read.
 */
export const getSeriesProgress = ({
    latestReadNumber,
    highestNumber,
    totalCount,
}: {
    latestReadNumber?: number | null;
    highestNumber?: number | null;
    totalCount?: number | null;
}): SeriesProgress | null => {
    if (!isKnownNumber(latestReadNumber) || latestReadNumber <= 0) {
        return null;
    }

    const denominator = isKnownNumber(highestNumber) && highestNumber > 0 ? highestNumber : (totalCount ?? 0);

    return { read: latestReadNumber, total: denominator >= latestReadNumber ? denominator : null };
};

/** Library badge text: "21/200", or just "21" without a usable total. */
export const formatSeriesProgress = ({ read, total }: SeriesProgress): string =>
    total === null ? formatChapterNumber(read) : `${formatChapterNumber(read)}/${formatChapterNumber(total)}`;

export const getChaptersLeft = ({ read, total }: SeriesProgress): number | null =>
    total === null ? null : Math.max(0, roundChapterNumber(total - read));

/** Reader denominator, computed from the full (unfiltered) chapter list of the manga. */
export const getReaderDenominator = (chapterNumbers: number[]): number | null => {
    if (chapterNumbers.length <= 1) {
        return null;
    }

    const knownNumbers = chapterNumbers.filter(isKnownNumber);
    const highestNumber = knownNumbers.length ? Math.max(...knownNumbers) : -1;

    return highestNumber > 0 ? highestNumber : chapterNumbers.length;
};

export const getReaderProgress = (
    current: number | null | undefined,
    denominator: number | null,
): { current: number; total: number | null } | null => {
    if (!isKnownNumber(current)) {
        return null;
    }

    return { current, total: denominator !== null && denominator > current ? denominator : null };
};
