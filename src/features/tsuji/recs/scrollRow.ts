/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Horizontal card rows (Similar, For You, Discover's Popular): decisions kept pure for tests.
 */

/** WheelEvent.deltaMode: Firefox reports a mouse wheel in lines, Chrome in pixels. */
const DOM_DELTA_LINE = 1;
const DOM_DELTA_PAGE = 2;
const LINE_PX = 40;

export const toPixels = (delta: number, deltaMode: number, pagePx: number): number => {
    if (deltaMode === DOM_DELTA_LINE) {
        return delta * LINE_PX;
    }
    if (deltaMode === DOM_DELTA_PAGE) {
        return delta * pagePx;
    }
    return delta;
};

/**
 * Wheel over a row: a mostly vertical wheel scrolls the row sideways by that amount, unless the row is already at
 * its end in that direction (then null: the page scrolls, no trap). Mostly horizontal input (trackpad swipe, tilt
 * wheel) is left to the browser.
 */
export const getWheelScroll = ({
    deltaX,
    deltaY,
    scrollLeft,
    maxScrollLeft,
}: {
    deltaX: number;
    deltaY: number;
    scrollLeft: number;
    maxScrollLeft: number;
}): number | null => {
    if (deltaY === 0 || Math.abs(deltaY) <= Math.abs(deltaX)) {
        return null;
    }
    if (deltaY > 0 && scrollLeft >= maxScrollLeft - 1) {
        return null;
    }
    if (deltaY < 0 && scrollLeft <= 1) {
        return null;
    }
    return deltaY;
};

/** Which edge arrows to show. */
export const getScrollEdges = (scrollLeft: number, clientWidth: number, scrollWidth: number) => ({
    canScrollLeft: scrollLeft > 1,
    canScrollRight: scrollLeft + clientWidth < scrollWidth - 1,
});

/** One arrow press: a viewport minus one card, so the last visible card stays in view. */
export const getPageScroll = (clientWidth: number, cardWidth: number) => Math.max(cardWidth, clientWidth - cardWidth);

export type SimilarLayout = 'row' | 'grid';

/** Stored choice, else a wrapped grid on touch screens (phone in bed) and a row with a mouse. */
export const getSimilarLayout = (stored: string | undefined, isCoarsePointer: boolean): SimilarLayout => {
    if (stored === 'row' || stored === 'grid') {
        return stored;
    }
    return isCoarsePointer ? 'grid' : 'row';
};

export const GRID_MAX_CARDS = 24;
export const GRID_MAX_ROWS = 4;

/** Cards shown before "More": 24, and never more than 4 rows at this width. */
export const getGridCap = (containerWidth: number, cardWidth: number, gap: number): number => {
    const columns = Math.max(1, Math.floor((containerWidth + gap) / (cardWidth + gap)));
    return Math.min(GRID_MAX_CARDS, columns * GRID_MAX_ROWS);
};
