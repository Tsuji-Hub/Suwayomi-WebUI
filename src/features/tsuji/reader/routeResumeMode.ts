/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo } from 'react';
import { ReaderResumeMode } from '@/features/reader/Reader.types.ts';

type ResumeChapter = { id: number; isRead: boolean; lastPageRead: number };

/**
 * Resume mode of the reader's initial chapter. Opening a chapter from the app passes one in the route state; a direct
 * URL load or a refresh (F5) has none, and upstream then starts at page 0. Without route state an unread chapter
 * with progress resumes at lastPageRead (as opening it from the chapter list does), a read or untouched one at the
 * start.
 */
export const getTsujiRouteResumeMode = (
    routeResumeMode: ReaderResumeMode | undefined,
    initialChapter: ResumeChapter | null | undefined,
    /** Upstream's default without route state. */
    fallback: ReaderResumeMode = ReaderResumeMode.START,
): ReaderResumeMode => {
    if (routeResumeMode !== undefined) {
        return routeResumeMode;
    }

    return initialChapter && !initialChapter.isRead && initialChapter.lastPageRead > 0
        ? ReaderResumeMode.LAST_READ
        : fallback;
};

/**
 * Hook for upstream's ReaderViewer (replaces its `resumeMode = START` default). Decided once per initial chapter, so
 * progress made while reading (lastPageRead, isRead) doesn't change the resume mode mid-session.
 */
export const useTsujiRouteResumeMode = (
    routeResumeMode: ReaderResumeMode | undefined,
    initialChapter: ResumeChapter | null | undefined,
    fallback: ReaderResumeMode,
): ReaderResumeMode =>
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    useMemo(
        () => getTsujiRouteResumeMode(routeResumeMode, initialChapter, fallback),
        [routeResumeMode, initialChapter?.id, fallback],
    );
