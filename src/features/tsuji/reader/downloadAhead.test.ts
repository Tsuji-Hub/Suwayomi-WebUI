/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { AheadChapter } from '@/features/tsuji/reader/downloadAheadPick.ts';
import { pickDownloadAheadIds } from '@/features/tsuji/reader/downloadAheadPick.ts';

/** The reader's next chapters, latest first: 15 (furthest) .. 11 (right after the current one). */
const next = (overrides: Record<number, Partial<AheadChapter>> = {}): AheadChapter[] =>
    [15, 14, 13, 12, 11].map((id) => ({ id, isRead: false, isDownloaded: false, ...overrides[id] }));

const pick = (options: Partial<Parameters<typeof pickDownloadAheadIds>[0]> = {}) =>
    pickDownloadAheadIds({
        currentPageIndex: 10,
        pageCount: 20,
        nextChapters: next(),
        limit: 2,
        isDownloading: () => false,
        ...options,
    });

describe('download ahead without the "already downloaded" rule', () => {
    it('queues the next 2 unread chapters although nothing is downloaded (upstream: nothing)', () =>
        expect(pick()).toEqual([12, 11]));

    it('waits until past 25 % of the current chapter', () => {
        expect(pick({ currentPageIndex: 4 })).toEqual([]);
        expect(pick({ currentPageIndex: 5 })).toEqual([12, 11]);
    });

    it('skips read, downloaded and downloading chapters without reaching further', () => {
        expect(pick({ nextChapters: next({ 11: { isRead: true } }) })).toEqual([13, 12]);
        expect(pick({ nextChapters: next({ 11: { isDownloaded: true } }) })).toEqual([12]);
        expect(pick({ isDownloading: (id) => id === 12 })).toEqual([11]);
    });

    it('off when the limit is 0 or there is no next chapter', () => {
        expect(pick({ limit: 0 })).toEqual([]);
        expect(pick({ nextChapters: [] })).toEqual([]);
    });
});
