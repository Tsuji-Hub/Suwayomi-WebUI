/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Reader comments, ported from Makimono's comments feature (behavior, not code). Each site is a CommentSource; only
 * Comick ships now, Webtoon and MangaDex forum plug in here later. Read-only: no posting, no login.
 */

export type CommentSourceId = 'comick';

export type Comment = {
    id: string;
    author: string;
    /** ISO date, or null when the site doesn't say. */
    createdAt: string | null;
    /** Raw text as the site sends it (rendered as plain text, never HTML). */
    body: string;
    upCount: number;
    replies: Comment[];
};

export type SeriesMatch = {
    /** Source-specific key, e.g. Comick "hid|id". */
    seriesKey: string;
    title: string;
};

export type ResolvedThread = { seriesKey: string; chapterKey: string; threadKey: string };

export type CommentPage = { comments: Comment[]; nextCursor: string | null };

export type SeriesCandidate = SeriesMatch & { score: number };

export interface CommentSource {
    id: CommentSourceId;
    name: string;
    /** Best match for these titles, or null below the source's threshold. */
    resolveSeries: (titles: string[], signal: AbortSignal) => Promise<SeriesMatch | null>;
    /** Candidates for a manual search ("Search Comick by another title"). */
    searchSeries: (query: string, signal: AbortSignal) => Promise<SeriesCandidate[]>;
    /** The discussion of one chapter number, or null when the source has none for it. */
    thread: (seriesKey: string, chapterNumber: number, signal: AbortSignal) => Promise<ResolvedThread | null>;
    /** One page of comments (Comick: everything in one page, replies inline, its own order). */
    comments: (thread: ResolvedThread, cursor: string | null, signal: AbortSignal) => Promise<CommentPage>;
}

/** The relay (CT100) could not be reached or failed: the panel shows one line with Retry. */
export class CommentsRelayError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'CommentsRelayError';
    }
}
