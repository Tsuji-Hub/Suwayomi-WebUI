/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import { ReaderResumeMode } from '@/features/reader/Reader.types.ts';
import {
    getTsujiRouteResumeMode,
    isReloadWhileReading,
    markTsujiReading,
    readReadingMarker,
} from '@/features/tsuji/reader/routeResumeMode.ts';

const LAST_PAGE = 9;
const chapter = (overrides: Partial<{ isRead: boolean; lastPageRead: number }> = {}) => ({
    id: 52950,
    isRead: false,
    lastPageRead: 4,
    ...overrides,
});

/**
 * Route state -> resume mode -> the page upstream scrolls to. The last step mirrors upstream's
 * getInitialReaderPageIndex (Reader.utils.ts needs a browser to import); the full route entry runs in
 * tools/scripts/tsuji/reader-resume.e2e.mjs against the production build.
 */
const initialPage = (routeState: { resumeMode?: ReaderResumeMode } | null, initial = chapter()) => {
    const chapterMode = getTsujiRouteResumeMode(routeState?.resumeMode, initial, ReaderResumeMode.START);
    const page = {
        [ReaderResumeMode.START]: 0,
        [ReaderResumeMode.END]: LAST_PAGE,
        [ReaderResumeMode.LAST_READ]: initial.lastPageRead,
    }[chapterMode];
    return { chapterMode, page };
};

describe('route resume mode (hard reload / direct URL)', () => {
    it('resumes an unread chapter at lastPageRead when the route has no state (F5, typed URL)', () => {
        expect(initialPage(null)).toEqual({ chapterMode: ReaderResumeMode.LAST_READ, page: 4 });
        expect(initialPage({})).toEqual({ chapterMode: ReaderResumeMode.LAST_READ, page: 4 });
    });

    it('starts at the top without route state for a read or untouched chapter (upstream default)', () => {
        expect(initialPage(null, chapter({ isRead: true }))).toEqual({ chapterMode: ReaderResumeMode.START, page: 0 });
        expect(initialPage(null, chapter({ lastPageRead: 0 }))).toEqual({
            chapterMode: ReaderResumeMode.START,
            page: 0,
        });
    });

    it('keeps an explicit resume mode from in-app navigation', () => {
        expect(initialPage({ resumeMode: ReaderResumeMode.START })).toEqual({
            chapterMode: ReaderResumeMode.START,
            page: 0,
        });
        expect(initialPage({ resumeMode: ReaderResumeMode.END })).toEqual({
            chapterMode: ReaderResumeMode.END,
            page: LAST_PAGE,
        });
    });

    it('waits for the chapter: no initial chapter yet means the upstream default', () =>
        expect(getTsujiRouteResumeMode(undefined, undefined, ReaderResumeMode.START)).toBe(ReaderResumeMode.START));
});

describe('reload while reading (F5 keeps the route state of the history entry)', () => {
    const PAGE_LOAD = 'load-2';
    const PATH = '/manga/450/chapter/3';
    const reload = (overrides: Partial<Parameters<typeof isReloadWhileReading>[0]> = {}) =>
        isReloadWhileReading({
            marker: { chapterId: 52950, pageLoadId: 'load-1' },
            chapterId: 52950,
            pageLoadId: PAGE_LOAD,
            pageLoadPath: PATH,
            currentPath: PATH,
            ...overrides,
        });

    it('resumes at lastPageRead whatever the route state says', () => {
        [ReaderResumeMode.START, ReaderResumeMode.END, undefined].forEach((routeMode) =>
            expect(getTsujiRouteResumeMode(routeMode, chapter({ isRead: true }), ReaderResumeMode.START, true)).toBe(
                ReaderResumeMode.LAST_READ,
            ),
        );
    });

    it('is a reload of this chapter when the tab was reading it before this page load, which started here', () =>
        expect(reload()).toBe(true));

    it('is not when the marker is from this page load (opened again in-app, or the reload was already used)', () =>
        expect(reload({ marker: { chapterId: 52950, pageLoadId: PAGE_LOAD } })).toBe(false));

    it('is not for another chapter, without a marker, or when the page load started elsewhere', () => {
        expect(reload({ chapterId: 52951 })).toBe(false);
        expect(reload({ marker: null })).toBe(false);
        expect(reload({ pageLoadPath: '/library' })).toBe(false);
        expect(reload({ pageLoadPath: null })).toBe(false);
    });

    it('writes the marker once per chapter and reads it back', () => {
        const data = new Map<string, string>();
        const storage = {
            getItem: (key: string) => data.get(key) ?? null,
            setItem: (key: string, value: string) => {
                data.set(key, value);
            },
        };
        markTsujiReading(7, storage, 'load-1');
        const first = readReadingMarker(storage);
        markTsujiReading(7, storage, 'load-1');

        expect(first).toEqual({ chapterId: 7, pageLoadId: 'load-1' });
        expect(readReadingMarker(storage)).toEqual(first);
        markTsujiReading(8, storage, 'load-1');
        expect(readReadingMarker(storage)).toEqual({ chapterId: 8, pageLoadId: 'load-1' });
        storage.setItem('tsuji_readerReading', JSON.stringify({ chapterId: 8, at: 1 })); // earlier draft format
        expect(readReadingMarker(storage)).toBeNull();
        storage.setItem('tsuji_readerReading', '{oops');
        expect(readReadingMarker(storage)).toBeNull();
    });
});
