/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';

/*
 * The user's public AniList manga list: the single "already read" source across devices, since Makimono and
 * Suwayomi both sync to it. Public query, no auth.
 */

export type ListStatus = 'CURRENT' | 'PLANNING' | 'COMPLETED' | 'DROPPED' | 'PAUSED' | 'REPEATING';

const LIST_STATUSES: ListStatus[] = ['CURRENT', 'PLANNING', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

/** mediaId -> [status, progress]: the compact form cached in TsujiCache (a few KB, well under its cap). */
export type CompactList = Record<string, [ListStatus, number]>;

export const MY_LIST_QUERY = `
    query TsujiMyList($userName: String) {
        MediaListCollection(userName: $userName, type: MANGA) {
            lists { isCustomList entries { mediaId status progress media { title { english romaji userPreferred } } } }
        }
    }
`;

type ListEntry = {
    mediaId: number | null;
    status: string | null;
    progress: number | null;
    media?: { title: { english: string | null; romaji: string | null; userPreferred: string | null } | null } | null;
} | null;

export type MyListResponse = {
    MediaListCollection: {
        lists: ({ isCustomList: boolean | null; entries: ListEntry[] | null } | null)[] | null;
    } | null;
};

const isListStatus = (status: unknown): status is ListStatus => LIST_STATUSES.includes(status as ListStatus);

/** Flattens every list; entries of the standard lists win over custom lists (which repeat the same media). */
export const parseMediaListCollection = (data: MyListResponse): CompactList => {
    const lists = (data.MediaListCollection?.lists ?? [])
        .filter((list) => !!list)
        .sort((a, b) => Number(!!a!.isCustomList) - Number(!!b!.isCustomList));

    const result: CompactList = {};
    lists.forEach((list) =>
        (list!.entries ?? []).forEach((entry) => {
            if (!entry || !Number.isInteger(entry.mediaId) || !isListStatus(entry.status)) {
                return;
            }

            const key = String(entry.mediaId);
            if (!(key in result)) {
                result[key] = [entry.status, Math.max(0, entry.progress ?? 0)];
            }
        }),
    );

    return result;
};

/**
 * Normalized title -> AniList id of every title on the list (brief #15): cards from Comick carry no AniList id, so
 * they are matched to the list by title (then list state, read marks and badges work on them). Keys are a short
 * hash of the normalized title, so a long list stays small in the cache.
 */
export type ListTitleIndex = Record<string, number>;

/** FNV-1a 32-bit of the normalized title, base 36. */
export const titleKey = (title: string | null | undefined): string | null => {
    const normalized = normalizeTitle(title);
    if (!normalized) {
        return null;
    }
    let hash = 0x811c9dc5;
    for (let index = 0; index < normalized.length; index += 1) {
        hash ^= normalized.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(36);
};

export const parseListTitleIndex = (data: MyListResponse): ListTitleIndex => {
    const index: ListTitleIndex = {};
    (data.MediaListCollection?.lists ?? []).forEach((list) =>
        (list?.entries ?? []).forEach((entry) => {
            const title = entry?.media?.title;
            if (!entry || !Number.isInteger(entry.mediaId) || !title) {
                return;
            }
            [title.english, title.romaji, title.userPreferred].forEach((name) => {
                const key = titleKey(name);
                if (key && !(key in index)) {
                    index[key] = entry.mediaId!;
                }
            });
        }),
    );
    return index;
};
