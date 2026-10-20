/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Reader page position (brief #7): the pages sit at the left or right edge of the reader (plus an offset) instead of
 * the middle, at the same size. Page widths are in vw, so only the chapter viewer's horizontal auto margins change;
 * everything else (sizes, tap zones, scroll position) stays as it is.
 */

export type PagePosition = 'LEFT' | 'CENTER' | 'RIGHT';

export const PAGE_POSITIONS: PagePosition[] = ['LEFT', 'CENTER', 'RIGHT'];

export const DEFAULT_PAGE_POSITION: PagePosition = 'CENTER';

export const PAGE_EDGE_OFFSET_MAX = 800;

/** Meta key names; the device prefix is added like upstream's reader settings (see usePagePosition). */
export const PAGE_POSITION_KEY = 'pagePosition';
export const PAGE_EDGE_OFFSET_KEY = 'pageEdgeOffset';

/**
 * Raw global meta key per device preset, like upstream's reader settings: `tsuji_pagePosition` on the default
 * device, `tsuji_<device>_pagePosition` on the others. The tsuji prefix keeps upstream's metadata migrations away.
 */
export const getPagePositionMetaKey = (key: string, device: string) =>
    ['tsuji', ...(device.toLowerCase() === 'default' ? [] : [device]), key].join('_');

export const parsePagePosition = (raw: string | undefined): PagePosition =>
    PAGE_POSITIONS.includes(raw as PagePosition) ? (raw as PagePosition) : DEFAULT_PAGE_POSITION;

export const parsePageEdgeOffset = (raw: string | number | undefined): number => {
    const value = Math.round(Number(raw));
    return Number.isFinite(value) ? Math.min(PAGE_EDGE_OFFSET_MAX, Math.max(0, value)) : 0;
};

export const getNextPagePosition = (position: PagePosition): PagePosition =>
    PAGE_POSITIONS[(PAGE_POSITIONS.indexOf(position) + 1) % PAGE_POSITIONS.length];

/** ReadingMode values (Reader.types.ts) this module cares about. */
const DOUBLE_PAGE = 1;
const CONTINUOUS_HORIZONTAL = 3;

type PositionSx = {
    marginLeft?: string;
    marginRight?: string;
    '& img'?: { marginLeft: string | number; marginRight: string | number };
};

/**
 * Horizontal margins for a chapter viewer (upstream centers it with `margin: auto`), and for its page images, which
 * upstream centers inside the column (`m: auto`): a not yet loaded page keeps a 40vw placeholder that can be wider
 * than a loaded image. Nothing for CENTER, for continuous horizontal, and for hidden chapter viewers (they keep
 * upstream's `margin: unset`); double page keeps its spread joined (images untouched).
 */
export const getPagePositionSx = (
    { position, offset }: { position: PagePosition; offset: number },
    readingMode: number,
    isHidden: boolean,
): PositionSx => {
    if (position === 'CENTER' || isHidden || readingMode === CONTINUOUS_HORIZONTAL) {
        return {};
    }
    const edge = `${parsePageEdgeOffset(offset)}px`;
    const isLeft = position === 'LEFT';
    return {
        ...(isLeft ? { marginLeft: edge, marginRight: 'auto' } : { marginLeft: 'auto', marginRight: edge }),
        ...(readingMode === DOUBLE_PAGE
            ? {}
            : { '& img': isLeft ? { marginLeft: 0, marginRight: 'auto' } : { marginLeft: 'auto', marginRight: 0 } }),
    };
};
