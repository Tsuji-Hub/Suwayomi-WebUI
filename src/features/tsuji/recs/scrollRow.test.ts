/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    getGridCap,
    getPageScroll,
    getScrollEdges,
    getSimilarLayout,
    getWheelScroll,
    toPixels,
} from '@/features/tsuji/recs/scrollRow.ts';

const wheel = (deltaY: number, scrollLeft: number, deltaX = 0) =>
    getWheelScroll({ deltaX, deltaY, scrollLeft, maxScrollLeft: 1000 });

describe('wheel over a row', () => {
    it('a vertical wheel scrolls the row sideways, both ways', () => {
        expect(wheel(100, 0)).toBe(100);
        expect(wheel(-100, 500)).toBe(-100);
    });

    it('lets the page scroll once the row is at its end in that direction (no trap)', () => {
        expect(wheel(100, 1000)).toBeNull();
        expect(wheel(100, 999.5)).toBeNull();
        expect(wheel(-100, 0)).toBeNull();
        // ...but the other direction still moves the row.
        expect(wheel(-100, 1000)).toBe(-100);
        expect(wheel(100, 0)).toBe(100);
    });

    it('leaves mostly horizontal input (trackpad swipe, tilt wheel) to the browser', () => {
        expect(wheel(30, 500, 80)).toBeNull();
        expect(wheel(50, 500, 50)).toBeNull();
        expect(wheel(0, 500)).toBeNull();
    });

    it('a row that cannot scroll never takes the wheel', () =>
        expect(getWheelScroll({ deltaX: 0, deltaY: 100, scrollLeft: 0, maxScrollLeft: 0 })).toBeNull());

    it('Firefox line and page wheel units become pixels', () => {
        expect(toPixels(3, 1, 800)).toBe(120);
        expect(toPixels(1, 2, 800)).toBe(800);
        expect(toPixels(100, 0, 800)).toBe(100);
    });
});

describe('edge arrows', () => {
    it('show only where the row can still scroll', () => {
        expect(getScrollEdges(0, 800, 2000)).toEqual({ canScrollLeft: false, canScrollRight: true });
        expect(getScrollEdges(600, 800, 2000)).toEqual({ canScrollLeft: true, canScrollRight: true });
        expect(getScrollEdges(1200, 800, 2000)).toEqual({ canScrollLeft: true, canScrollRight: false });
        expect(getScrollEdges(0, 800, 800)).toEqual({ canScrollLeft: false, canScrollRight: false });
    });

    it('one press = the visible width minus one card (at least one card)', () => {
        expect(getPageScroll(800, 140)).toBe(660);
        expect(getPageScroll(150, 140)).toBe(140);
    });
});

describe('Similar layout', () => {
    it('default: grid on touch screens, row with a mouse; a stored choice wins on every device', () => {
        expect(getSimilarLayout(undefined, true)).toBe('grid');
        expect(getSimilarLayout(undefined, false)).toBe('row');
        expect(getSimilarLayout('row', true)).toBe('row');
        expect(getSimilarLayout('grid', false)).toBe('grid');
        expect(getSimilarLayout('bogus', false)).toBe('row');
    });

    it('grid shows at most 24 cards and 4 rows at the current width', () => {
        // Phone, 360 px: 2 columns of 140 px + 12 px gap -> 8 cards.
        expect(getGridCap(360, 140, 12)).toBe(8);
        // Projector, 1600 px: 10 columns -> capped at 24.
        expect(getGridCap(1600, 140, 12)).toBe(24);
        expect(getGridCap(100, 140, 12)).toBe(4);
    });
});
