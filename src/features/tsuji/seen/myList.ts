/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

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
            lists { isCustomList entries { mediaId status progress } }
        }
    }
`;

type ListEntry = { mediaId: number | null; status: string | null; progress: number | null } | null;

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
