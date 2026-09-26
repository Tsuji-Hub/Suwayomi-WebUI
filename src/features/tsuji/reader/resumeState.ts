/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * The reader's resume restore that is currently running (or ran on this reader mount). Kept free of imports so
 * upstream's ReaderControls can ask it without pulling in anything else.
 */
type ResumeRestore = {
    chapterId: number;
    pageIndex: number;
    isPinActive: () => boolean;
    /** The saved in-page offset waits for the target's real height. */
    isOffsetPending: () => boolean;
    /** The user scrolled, swiped, clicked or pressed a key since the restore started. */
    hasUserMoved: boolean;
};

let restore: ResumeRestore | null = null;

export const setResumeRestore = (next: ResumeRestore) => {
    restore = next;
};

export const markResumeUserMoved = (chapterId: number) => {
    if (restore?.chapterId === chapterId) {
        restore.hasUserMoved = true;
    }
};

export const clearResumeRestore = (chapterId: number) => {
    if (restore?.chapterId === chapterId) {
        restore = null;
    }
};

/** Pinned, or the offset is not applied yet: the in-page offset must not be saved over (it's still to be used). */
export const isResumeSettling = (chapterId: number): boolean =>
    restore?.chapterId === chapterId && (restore.isPinActive() || restore.isOffsetPending());

/**
 * Hook for upstream's lastPageRead write: no write at all while the pin runs, and no write below the restored page
 * until the user has moved (the page positions the restore itself passes through are not reading progress).
 */
export const shouldSkipTsujiProgressWrite = (chapterId: number, pageIndex: number): boolean => {
    if (!restore || restore.chapterId !== chapterId) {
        return false;
    }

    if (restore.isPinActive()) {
        return true;
    }

    return !restore.hasUserMoved && pageIndex < restore.pageIndex;
};
