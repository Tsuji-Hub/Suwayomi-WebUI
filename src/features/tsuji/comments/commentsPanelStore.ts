/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { create } from 'zustand';

/**
 * Which chapter's comments the series page panel shows. The chapter rows only call `openCommentsPanel` (so each
 * row stays a small icon button); the one panel is mounted by the Similar section of that page.
 */
export type CommentsPanelRequest = {
    mangaId: number;
    chapterNumber: number;
    /** Scanlator of the opened copy: labels the selector with that copy's chapter names. */
    scanlator?: string | null;
    /** Increases on every open, so reopening the same chapter starts the selector over. */
    openCount: number;
};

type CommentsPanelStore = { request: CommentsPanelRequest | null };

export const useCommentsPanelStore = create<CommentsPanelStore>(() => ({ request: null }));

let openCount = 0;

export const openCommentsPanel = (request: Omit<CommentsPanelRequest, 'openCount'>) => {
    openCount += 1;
    useCommentsPanelStore.setState({ request: { ...request, openCount } });
};

export const closeCommentsPanel = () => useCommentsPanelStore.setState({ request: null });
