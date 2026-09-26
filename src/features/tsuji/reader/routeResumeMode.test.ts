/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import { ReaderResumeMode } from '@/features/reader/Reader.types.ts';
import { getTsujiRouteResumeMode } from '@/features/tsuji/reader/routeResumeMode.ts';

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
