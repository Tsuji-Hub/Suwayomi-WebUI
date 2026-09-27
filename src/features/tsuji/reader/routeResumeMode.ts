/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useMemo } from 'react';
import { ReaderResumeMode } from '@/features/reader/Reader.types.ts';
import { USER_INTENT_EVENTS } from '@/features/tsuji/reader/resumePin.ts';
import { setTsujiReaderUserInput } from '@/features/tsuji/reader/resumeState.ts';

type ResumeChapter = { id: number; isRead: boolean; lastPageRead: number };

/**
 * sessionStorage (per tab, survives F5): the chapter this tab was reading, and in which page load. Written once the
 * user reads (see useTsujiReaderResume), so a reload can tell a reader in use from one that was only opened.
 */
export const READING_MARKER_SESSION_KEY = 'tsuji_readerReading';

export type ReadingMarker = { chapterId: number; pageLoadId: string };

/**
 * Identifies this page load (modules are evaluated once per document). An id, not a time: Date.now() and
 * performance.timeOrigin are different clocks that drift apart (e.g. across system sleep).
 */
export const PAGE_LOAD_ID = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;

type MarkerStorage = Pick<Storage, 'getItem' | 'setItem'>;

const getSessionStorage = (): MarkerStorage | null => {
    try {
        return window.sessionStorage;
    } catch {
        return null;
    }
};

export const readReadingMarker = (storage: MarkerStorage | null): ReadingMarker | null => {
    try {
        const parsed: unknown = JSON.parse(storage?.getItem(READING_MARKER_SESSION_KEY) ?? 'null');
        const { chapterId, pageLoadId } = (parsed ?? {}) as Partial<ReadingMarker>;
        return typeof chapterId === 'number' && typeof pageLoadId === 'string' ? { chapterId, pageLoadId } : null;
    } catch {
        return null;
    }
};

let markedChapterId: number | null = null;

/** Once per chapter and page load (the page load id doesn't change). */
export const markTsujiReading = (
    chapterId: number,
    storage: MarkerStorage | null = getSessionStorage(),
    pageLoadId: string = PAGE_LOAD_ID,
) => {
    if (markedChapterId === chapterId || !storage) {
        return;
    }

    markedChapterId = chapterId;
    try {
        storage.setItem(READING_MARKER_SESSION_KEY, JSON.stringify({ chapterId, pageLoadId }));
    } catch {
        // Storage blocked: a reload falls back to the route state.
    }
};

/**
 * This page load is a reload (F5, restored tab) of the reader while it was reading `chapterId`: the marker is from a
 * previous page load of this tab, and this page load started on the reader URL that is open now (not an in-app
 * navigation to it later). Used once: the hook then marks the chapter for this page load.
 */
export const isReloadWhileReading = ({
    marker,
    chapterId,
    pageLoadId,
    pageLoadPath,
    currentPath,
}: {
    marker: ReadingMarker | null;
    chapterId: number | undefined;
    pageLoadId: string;
    /** Path of the URL this page load started at. */
    pageLoadPath: string | null;
    currentPath: string;
}): boolean =>
    !!marker &&
    marker.chapterId === chapterId &&
    marker.pageLoadId !== pageLoadId &&
    pageLoadPath !== null &&
    pageLoadPath === currentPath;

const getPageLoadPath = (): string | null => {
    try {
        const [entry] = performance.getEntriesByType('navigation');
        return entry ? new URL(entry.name).pathname : null;
    } catch {
        return null;
    }
};

/**
 * Resume mode of the reader's initial chapter. Opening a chapter from the app passes one in the route state; a direct
 * URL load has none, and upstream then starts at page 0. Without route state an unread chapter with progress resumes
 * at lastPageRead (as opening it from the chapter list does), a read or untouched one at the start.
 *
 * The browser keeps a history entry's route state across F5, so a reload after reading would go back to wherever the
 * chapter was first opened (page 0 after the reader's own chapter navigation): a reload while reading resumes at
 * lastPageRead instead.
 */
export const getTsujiRouteResumeMode = (
    routeResumeMode: ReaderResumeMode | undefined,
    initialChapter: ResumeChapter | null | undefined,
    /** Upstream's default without route state. */
    fallback: ReaderResumeMode = ReaderResumeMode.START,
    wasReadingBeforeReload: boolean = false,
): ReaderResumeMode => {
    if (initialChapter && wasReadingBeforeReload) {
        return ReaderResumeMode.LAST_READ;
    }

    if (routeResumeMode !== undefined) {
        return routeResumeMode;
    }

    return initialChapter && !initialChapter.isRead && initialChapter.lastPageRead > 0
        ? ReaderResumeMode.LAST_READ
        : fallback;
};

/**
 * Hook for upstream's ReaderViewer (replaces its `resumeMode = START` default). Decided once per initial chapter, so
 * progress made while reading (lastPageRead, isRead) doesn't change the resume mode mid-session. Also tracks whether
 * the user has touched the reader since this initial chapter opened (hasTsujiReaderUserInput).
 */
export const useTsujiRouteResumeMode = (
    routeResumeMode: ReaderResumeMode | undefined,
    initialChapter: ResumeChapter | null | undefined,
    fallback: ReaderResumeMode,
): ReaderResumeMode => {
    const initialChapterId = initialChapter?.id;

    // Reset per initial chapter: the click or key that opened another chapter in-app isn't reading it.
    useEffect(() => {
        setTsujiReaderUserInput(false);
        const onUserInput = () => setTsujiReaderUserInput(true);
        USER_INTENT_EVENTS.forEach((type) =>
            window.addEventListener(type, onUserInput, { capture: true, passive: true }),
        );
        return () =>
            USER_INTENT_EVENTS.forEach((type) => window.removeEventListener(type, onUserInput, { capture: true }));
    }, [initialChapterId]);

    const isReload = useMemo(
        () =>
            isReloadWhileReading({
                marker: readReadingMarker(getSessionStorage()),
                chapterId: initialChapterId,
                pageLoadId: PAGE_LOAD_ID,
                pageLoadPath: getPageLoadPath(),
                currentPath: window.location.pathname,
            }),
        [initialChapterId],
    );

    // Used once: a later in-app open of this chapter in the same page load follows its route state again.
    useEffect(() => {
        if (isReload && initialChapterId !== undefined) {
            markTsujiReading(initialChapterId);
        }
    }, [isReload, initialChapterId]);

    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(
        () => getTsujiRouteResumeMode(routeResumeMode, initialChapter, fallback, isReload),
        [routeResumeMode, initialChapterId, fallback, isReload],
    );
};
