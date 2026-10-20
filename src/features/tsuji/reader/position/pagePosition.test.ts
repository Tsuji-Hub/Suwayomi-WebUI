/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    getNextPagePosition,
    getPagePositionMetaKey,
    getPagePositionSx,
    parsePageEdgeOffset,
    parsePagePosition,
} from '@/features/tsuji/reader/position/pagePosition.ts';

const CONTINUOUS_VERTICAL = 2;
const CONTINUOUS_HORIZONTAL = 3;
const SINGLE_PAGE = 0;
const DOUBLE_PAGE = 1;

describe('page position', () => {
    it('parses stored values with CENTER / 0 as fallback, offset clamped to 0..800', () => {
        expect(parsePagePosition('LEFT')).toBe('LEFT');
        expect(parsePagePosition('left')).toBe('CENTER');
        expect(parsePagePosition(undefined)).toBe('CENTER');
        expect(parsePageEdgeOffset('120')).toBe(120);
        expect(parsePageEdgeOffset('-5')).toBe(0);
        expect(parsePageEdgeOffset('5000')).toBe(800);
        expect(parsePageEdgeOffset('x')).toBe(0);
        expect(parsePageEdgeOffset(undefined)).toBe(0);
    });

    it('cycles Left -> Center -> Right -> Left', () => {
        expect(getNextPagePosition('LEFT')).toBe('CENTER');
        expect(getNextPagePosition('CENTER')).toBe('RIGHT');
        expect(getNextPagePosition('RIGHT')).toBe('LEFT');
    });

    it('keys per device preset, like upstream reader settings', () => {
        expect(getPagePositionMetaKey('pagePosition', 'default')).toBe('tsuji_pagePosition');
        expect(getPagePositionMetaKey('pagePosition', 'GamingPC')).toBe('tsuji_GamingPC_pagePosition');
        expect(getPagePositionMetaKey('pageEdgeOffset', 'GamingPC')).toBe('tsuji_GamingPC_pageEdgeOffset');
    });

    it('moves only the horizontal auto margins', () => {
        expect(getPagePositionSx({ position: 'LEFT', offset: 0 }, CONTINUOUS_VERTICAL, false)).toEqual({
            marginLeft: '0px',
            marginRight: 'auto',
            '& img': { marginLeft: 0, marginRight: 'auto' },
        });
        expect(getPagePositionSx({ position: 'RIGHT', offset: 40 }, SINGLE_PAGE, false)).toEqual({
            marginLeft: 'auto',
            marginRight: '40px',
            '& img': { marginLeft: 'auto', marginRight: 0 },
        });
        // Double page: the spread stays joined, only the column moves.
        expect(getPagePositionSx({ position: 'LEFT', offset: 0 }, DOUBLE_PAGE, false)).toEqual({
            marginLeft: '0px',
            marginRight: 'auto',
        });
        expect(getPagePositionSx({ position: 'CENTER', offset: 40 }, CONTINUOUS_VERTICAL, false)).toEqual({});
    });

    it('leaves hidden chapter viewers and continuous horizontal alone', () => {
        expect(getPagePositionSx({ position: 'LEFT', offset: 10 }, CONTINUOUS_VERTICAL, true)).toEqual({});
        expect(getPagePositionSx({ position: 'LEFT', offset: 10 }, CONTINUOUS_HORIZONTAL, false)).toEqual({});
    });
});
