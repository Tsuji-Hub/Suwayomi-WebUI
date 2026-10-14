/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { parseSeriesKey } from '@/features/tsuji/comments/comick.ts';

/** `tsuji_commentsMatch`: manual Comick matches `{ [mangaId]: "hid|id" }`, shared by every device. */
export type CommentMatches = Record<string, string>;

/** Global meta values are capped at 4096 chars by the server; refuse before that (~150 manual matches). */
export const MATCHES_MAX_CHARS = 3800;

export class CommentMatchesFullError extends Error {
    constructor(readonly length: number) {
        super(`tsuji_commentsMatch would be ${length} chars (max ${MATCHES_MAX_CHARS}); nothing was saved`);
        this.name = 'CommentMatchesFullError';
    }
}

/** Tolerant parse: keeps only `positive manga id -> valid series key`. */
export const parseCommentMatches = (raw: string | undefined): CommentMatches => {
    if (!raw) {
        return {};
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            return {};
        }
        return Object.fromEntries(
            Object.entries(parsed).filter(
                (entry): entry is [string, string] =>
                    /^[1-9]\d*$/.test(entry[0]) && typeof entry[1] === 'string' && !!parseSeriesKey(entry[1]),
            ),
        );
    } catch {
        return {};
    }
};

/** A patch sets (`"hid|id"`) or clears (`null`) one manga's match; the rest of the server value is kept. */
export const applyMatchPatch = (current: CommentMatches, patch: Record<string, string | null>): CommentMatches => {
    const next = { ...current };
    Object.entries(patch).forEach(([mangaId, key]) => {
        if (key) {
            next[mangaId] = key;
        } else {
            delete next[mangaId];
        }
    });
    return next;
};

/** Merge-on-write like `tsuji_seen`: read the server's value, patch, check the size, write once; serialized. */
export const createMatchUpdater = ({
    read,
    write,
}: {
    read: () => Promise<CommentMatches>;
    write: (value: string) => Promise<void>;
}) => {
    let queue: Promise<unknown> = Promise.resolve();
    return (patch: Record<string, string | null>): Promise<CommentMatches> => {
        const run = queue.then(async () => {
            const next = applyMatchPatch(await read(), patch);
            const value = JSON.stringify(next);
            if (value.length > MATCHES_MAX_CHARS) {
                throw new CommentMatchesFullError(value.length);
            }
            await write(value);
            return next;
        });
        queue = run.catch(() => undefined);
        return run;
    };
};
