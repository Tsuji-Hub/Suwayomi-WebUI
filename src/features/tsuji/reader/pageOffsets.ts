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

/** How close to a page top the viewport top has to be to count as sitting on it. */
const PAGE_TOP_TOLERANCE_PX = 2;

/**
 * Before the user's first scroll, swipe, click or key, a viewport top sitting on a page top is the reader's own
 * position (upstream's scroll to a page, a restore without in-page offset) and must not overwrite a saved spot.
 * Anywhere else the view was moved by the user, whatever the means (wheel, keys, scrollbar, assistive tech), and is
 * saved.
 */
export const isReaderOwnPosition = (hasUserInput: boolean, scrollTop: number, pageTop: number): boolean =>
    !hasUserInput && Math.abs(scrollTop - pageTop) <= PAGE_TOP_TOLERANCE_PX;

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

/** The saved spot for this chapter, whatever its page. */
export const readSavedSpot = (
    storage: OffsetStorage,
    chapterId: number,
): [pageIndex: number, offset: number] | null => {
    const entry = readAll(storage)[toKey(chapterId)];
    return Array.isArray(entry) && Number.isInteger(entry[0]) && typeof entry[1] === 'number'
        ? [entry[0], clamp01(entry[1])]
        : null;
};

/**
 * Where to resume: lastPageRead plus the offset saved on that page. On a reload while reading, this tab's saved spot
 * wins when it is on or past lastPageRead: upstream writes lastPageRead 1 s after a page change, so an F5 right after
 * scrolling into the next page would otherwise land on the previous page's top. A spot before it never lowers the
 * server's progress.
 */
export const getResumeSpot = (
    storage: OffsetStorage | null,
    chapterId: number,
    lastPageRead: number,
    isReloadWhileReading: boolean,
): [pageIndex: number, offset: number] => {
    const saved = storage ? readSavedSpot(storage, chapterId) : null;
    if (isReloadWhileReading && saved && saved[0] >= lastPageRead) {
        return saved;
    }

    return [lastPageRead, storage ? readPageOffset(storage, chapterId, lastPageRead) : 0];
};

/** `isWritten` is false when storage refused the write (full or blocked); the stored value is then unchanged. */
export const writePageOffset = (
    storage: OffsetStorage,
    chapterId: number,
    pageIndex: number,
    offset: number,
): { isWritten: boolean; error: string | null } => {
    const all = readAll(storage);
    const key = toKey(chapterId);
    const previous = all[key];
    if (previous && previous[0] === pageIndex && previous[1] === offset) {
        return { isWritten: true, error: null };
    }

    // Re-insert so key order is least to most recently written, then drop the oldest over the cap.
    delete all[key];
    all[key] = [pageIndex, clamp01(offset)];
    const keys = Object.keys(all);
    keys.slice(0, Math.max(0, keys.length - PAGE_OFFSETS_MAX_CHAPTERS)).forEach((oldKey) => delete all[oldKey]);

    try {
        storage.setItem(PAGE_OFFSETS_STORAGE_KEY, JSON.stringify(all));
        return { isWritten: true, error: null };
    } catch (error) {
        return { isWritten: false, error: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
    }
};
