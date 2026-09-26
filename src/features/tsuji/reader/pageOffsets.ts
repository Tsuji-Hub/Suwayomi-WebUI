/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Where inside the current page the reader was (0 = page top, 1 = page bottom), per chapter, in this browser's
 * localStorage. lastPageRead on the server only knows the page; this makes resume land on the exact spot.
 */
export const PAGE_OFFSETS_STORAGE_KEY = 'tsuji_readerPageOffsets';

/** Most recently read chapters kept; older ones are dropped. */
export const PAGE_OFFSETS_MAX_CHAPTERS = 200;

type StoredOffsets = Record<string, [pageIndex: number, offset: number]>;

// Not the bare id: integer-like keys are ordered numerically, which would break the recency order used for the cap.
const toKey = (chapterId: number) => `c${chapterId}`;

type OffsetStorage = Pick<Storage, 'getItem' | 'setItem'>;

const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

/** Offset of `scrollTop` inside a page starting at `pageTop`, rounded to 4 decimals; 0 for a page without height. */
export const getPageOffset = (scrollTop: number, pageTop: number, pageHeight: number): number =>
    pageHeight > 0 ? Math.round(clamp01((scrollTop - pageTop) / pageHeight) * 10_000) / 10_000 : 0;

const readAll = (storage: OffsetStorage): StoredOffsets => {
    try {
        const parsed: unknown = JSON.parse(storage.getItem(PAGE_OFFSETS_STORAGE_KEY) ?? '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as StoredOffsets) : {};
    } catch {
        return {};
    }
};

/** The saved offset for this chapter, only if it was saved on `pageIndex` (else the page start). */
export const readPageOffset = (storage: OffsetStorage, chapterId: number, pageIndex: number): number => {
    const entry = readAll(storage)[toKey(chapterId)];
    if (!Array.isArray(entry) || entry[0] !== pageIndex || typeof entry[1] !== 'number') {
        return 0;
    }

    return clamp01(entry[1]);
};

export const writePageOffset = (storage: OffsetStorage, chapterId: number, pageIndex: number, offset: number) => {
    const all = readAll(storage);
    const key = toKey(chapterId);
    const previous = all[key];
    if (previous && previous[0] === pageIndex && previous[1] === offset) {
        return;
    }

    // Re-insert so key order is least to most recently written, then drop the oldest over the cap.
    delete all[key];
    all[key] = [pageIndex, clamp01(offset)];
    const keys = Object.keys(all);
    keys.slice(0, Math.max(0, keys.length - PAGE_OFFSETS_MAX_CHAPTERS)).forEach((oldKey) => delete all[oldKey]);

    try {
        storage.setItem(PAGE_OFFSETS_STORAGE_KEY, JSON.stringify(all));
    } catch {
        // Storage full or blocked: resume falls back to the page start.
    }
};
