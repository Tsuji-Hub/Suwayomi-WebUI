/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { MEDIA_FIELDS } from '@/features/tsuji/recs/aniListQueries.ts';
import type { RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import type { TasteEntry, TasteStatus } from '@/features/tsuji/forYou/tasteProfile.ts';

/** The list with what the profile needs: score, last update and each title's tags. Planned titles say nothing. */
export const TASTE_LIST_QUERY = `
    query TsujiTasteList($userName: String) {
        MediaListCollection(
            userName: $userName, type: MANGA, status_in: [CURRENT, COMPLETED, DROPPED, PAUSED, REPEATING]
        ) {
            lists {
                isCustomList
                entries {
                    mediaId status progress updatedAt
                    score(format: POINT_100)
                    media {
                        title { userPreferred english romaji }
                        tags { name rank category isMediaSpoiler isGeneralSpoiler isAdult }
                    }
                }
            }
        }
    }
`;

type TasteListEntry = {
    mediaId: number | null;
    status: string | null;
    progress: number | null;
    score: number | null;
    updatedAt: number | null;
    media: {
        title: { userPreferred: string | null; english: string | null; romaji: string | null } | null;
        tags: RecTag[] | null;
    } | null;
} | null;

export type TasteListResponse = {
    MediaListCollection: {
        lists: ({ isCustomList: boolean | null; entries: TasteListEntry[] | null } | null)[] | null;
    } | null;
};

const TASTE_STATUSES: TasteStatus[] = ['CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED', 'REPEATING'];

/** Flattens every list (standard lists win over custom ones, which repeat the same media); drops broken entries. */
export const parseTasteList = (data: TasteListResponse): TasteEntry[] => {
    const lists = (data.MediaListCollection?.lists ?? [])
        .filter((list) => !!list)
        .sort((a, b) => Number(!!a!.isCustomList) - Number(!!b!.isCustomList));

    const byId = new Map<number, TasteEntry>();
    lists.forEach((list) =>
        (list!.entries ?? []).forEach((entry) => {
            const status = entry?.status as TasteStatus;
            if (!entry || !Number.isInteger(entry.mediaId) || !TASTE_STATUSES.includes(status)) {
                return;
            }
            if (byId.has(entry.mediaId!)) {
                return;
            }
            const title = entry.media?.title;
            byId.set(entry.mediaId!, {
                mediaId: entry.mediaId!,
                status,
                progress: Math.max(0, entry.progress ?? 0),
                score: Math.max(0, Math.min(100, entry.score ?? 0)),
                updatedAt: Math.max(0, entry.updatedAt ?? 0),
                title: title?.english ?? title?.userPreferred ?? title?.romaji ?? '',
                tags: entry.media?.tags ?? [],
            });
        }),
    );

    return [...byId.values()];
};

/** Recommendations per seed; 4 seeds x 20 edges fits AniList's query complexity limit in one request. */
export const SEED_EDGES_PER_SEED = 20;

/** One request for all of this week's seeds (aliases s0, s1, ...). */
export const buildSeedsQuery = (count: number) => `
    ${MEDIA_FIELDS}
    query TsujiForYouSeeds(${Array.from({ length: count }, (_, index) => `$id${index}: Int`).join(', ')}) {
        ${Array.from(
            { length: count },
            (_, index) => `
        s${index}: Media(id: $id${index}, type: MANGA) {
            id
            recommendations(sort: RATING_DESC, perPage: ${SEED_EDGES_PER_SEED}) {
                nodes { rating mediaRecommendation { ...TsujiMedia } }
            }
        }`,
        ).join('\n')}
    }
`;

export type SeedEdges = {
    id: number;
    recommendations: { nodes: { rating: number | null; mediaRecommendation: RecMedia | null }[] } | null;
} | null;

export type SeedsResponse = Record<string, SeedEdges>;

export const RECALL_PER_PAGE = 40;

/** Taste recall: popular titles with the core tags, best-scored ones with this week's rotating tags. */
export const TASTE_RECALL_QUERY = `
    ${MEDIA_FIELDS}
    query TsujiForYouRecall($core: [String], $rotating: [String], $withRotating: Boolean!) {
        core: Page(perPage: ${RECALL_PER_PAGE}) {
            media(tag_in: $core, type: MANGA, sort: [POPULARITY_DESC], minimumTagRank: 60) { ...TsujiMedia }
        }
        rotating: Page(perPage: ${RECALL_PER_PAGE}) @include(if: $withRotating) {
            media(tag_in: $rotating, type: MANGA, sort: [SCORE_DESC], minimumTagRank: 60) { ...TsujiMedia }
        }
    }
`;

export type RecallResponse = {
    core?: { media: RecMedia[] | null } | null;
    rotating?: { media: RecMedia[] | null } | null;
};
