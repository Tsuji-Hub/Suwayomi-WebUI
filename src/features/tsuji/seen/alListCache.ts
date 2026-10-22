/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { CompactList, ListStatus, ListTitleIndex } from '@/features/tsuji/seen/myList.ts';
import { titleKey } from '@/features/tsuji/seen/myList.ts';

/*
 * The server's copy of the AniList list (brief #17): a PVE timer (`al-list-cache`, every 3 h, with the sync's token,
 * so private entries too) keeps it in Suwayomi global meta and keeps the old copy when AniList fails. Read only here,
 * when AniList itself can't be asked. A meta value holds at most 4096 characters, so the rows are split:
 *   tsuji_alListCache   = {"v":1,"user":"ejustice","at":<epoch s>,"source":"seed"|"anilist","n":403,"parts":6}
 *   tsuji_alListCache_0 .. _<parts-1> = the JSON of `[[anilistId, status, progress, title], ...]`, in pieces.
 * The index is written last: parts are used only when its count matches, so a half-written copy is never read.
 */

export const AL_LIST_CACHE_KEY = 'tsuji_alListCache';

const STATUSES: ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

export type SavedList = {
    /** Epoch seconds of the copy. */
    at: number;
    /** "seed" = built without AniList (an older snapshot + track records); "anilist" = a real refresh. */
    source: string;
    list: CompactList;
    titleIndex: ListTitleIndex;
};

type Row = [number, ListStatus, number, string];

const isRow = (row: unknown): row is Row =>
    Array.isArray(row) &&
    Number.isInteger(row[0]) &&
    row[0] > 0 &&
    STATUSES.includes(row[1] as ListStatus) &&
    (typeof row[3] === 'string' || row[3] === undefined || row[3] === null);

/** The rows of the parts: one JSON split across them (else each part a JSON array of its own). */
const parseRows = (parts: string[]): unknown[] | null => {
    try {
        const rows = JSON.parse(parts.join(''));
        return Array.isArray(rows) ? rows : null;
    } catch {
        try {
            return parts.flatMap((part) => {
                const rows = JSON.parse(part);
                if (!Array.isArray(rows)) {
                    throw new Error('not an array');
                }
                return rows;
            });
        } catch {
            return null;
        }
    }
};

/** The copy for this user from the raw global meta, or null (missing, another user, half-written, unreadable). */
export const parseSavedList = (rawMeta: Record<string, string | undefined>, userName: string): SavedList | null => {
    let index: { user?: unknown; at?: unknown; source?: unknown; parts?: unknown };
    try {
        index = JSON.parse(rawMeta[AL_LIST_CACHE_KEY] ?? '');
    } catch {
        return null;
    }
    const parts = Number(index?.parts);
    if (
        typeof index?.user !== 'string' ||
        index.user.toLowerCase() !== userName.toLowerCase() ||
        !Number.isInteger(parts) ||
        parts <= 0
    ) {
        return null;
    }
    const pieces = Array.from({ length: parts }, (_, part) => rawMeta[`${AL_LIST_CACHE_KEY}_${part}`]);
    if (pieces.some((piece) => piece === undefined)) {
        return null;
    }
    const rows = parseRows(pieces as string[]);
    if (!rows) {
        return null;
    }
    const list: CompactList = {};
    const titleIndex: ListTitleIndex = {};
    rows.filter(isRow).forEach(([id, status, progress, title]) => {
        list[String(id)] ??= [status, Math.max(0, Number(progress) || 0)];
        const key = titleKey(title);
        if (key && !(key in titleIndex)) {
            titleIndex[key] = id;
        }
    });
    return {
        at: Number(index.at) || 0,
        source: typeof index.source === 'string' ? index.source : '',
        list,
        titleIndex,
    };
};
