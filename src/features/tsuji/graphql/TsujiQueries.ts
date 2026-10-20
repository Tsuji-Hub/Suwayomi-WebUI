/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import gql from 'graphql-tag';

/** Library titles + tracker ids + read chapter count, for "Hide what I've started" on Similar and Discover. */
export const TSUJI_LIBRARY_INDEX = gql`
    query TSUJI_LIBRARY_INDEX {
        mangas(condition: { inLibrary: true }) {
            nodes {
                id
                title
                unreadCount
                chapters {
                    totalCount
                }
                trackRecords {
                    nodes {
                        id
                        trackerId
                        remoteId
                    }
                }
            }
        }
    }
`;

/** Every chapter of the mangas the given chapters belong to, for marking duplicate copies read. */
export const TSUJI_CHAPTER_COPIES = gql`
    query TSUJI_CHAPTER_COPIES($ids: [Int!]!) {
        chapters(filter: { id: { in: $ids } }) {
            nodes {
                id
                manga {
                    id
                    chapters {
                        nodes {
                            id
                            chapterNumber
                            isRead
                        }
                    }
                }
            }
        }
    }
`;

/**
 * New-chapter bell (brief #10), one light request: unread library chapters fetched since `$since` (newest first,
 * capped), each with a few fields of its series, plus the category list for the bell's settings. Never a series'
 * whole chapter list (a nested mangas -> chapters query ran the server out of heap before).
 */
export const TSUJI_CHAPTER_BELL = gql`
    query TSUJI_CHAPTER_BELL($since: LongString!, $first: Int!) {
        categories {
            nodes {
                id
                name
            }
        }
        chapters(
            filter: { inLibrary: { equalTo: true }, isRead: { equalTo: false }, fetchedAt: { greaterThan: $since } }
            order: [{ by: FETCHED_AT, byType: DESC }]
            first: $first
        ) {
            nodes {
                id
                mangaId
                chapterNumber
                fetchedAt
                sourceOrder
                isRead
                manga {
                    id
                    title
                    thumbnailUrl
                    unreadCount
                    latestReadChapter {
                        id
                        chapterNumber
                    }
                    categories {
                        nodes {
                            id
                            name
                        }
                    }
                }
            }
        }
    }
`;
