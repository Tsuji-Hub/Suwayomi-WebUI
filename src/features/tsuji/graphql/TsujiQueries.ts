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
 * New-chapter bell (brief #12), first request: the category list (for the settings) and the watched categories'
 * series with what the rules need, nothing per chapter. `$filter` picks the watched categories (saved ids, else the
 * names ongoing / Completed).
 */
export const TSUJI_BELL_SERIES = gql`
    query TSUJI_BELL_SERIES($filter: CategoryFilterInput) {
        categories {
            nodes {
                id
                name
            }
        }
        watched: categories(filter: $filter) {
            nodes {
                id
                name
                mangas {
                    nodes {
                        id
                        title
                        thumbnailUrl
                        inLibrary
                        inLibraryAt
                        unreadCount
                        lastReadChapter {
                            id
                            lastReadAt
                        }
                        latestFetchedChapter {
                            id
                            fetchedAt
                        }
                    }
                }
            }
        }
    }
`;

/** New-chapter bell, then: every chapter (light fields) of up to 60 of those series per request, one after another. */
export const TSUJI_BELL_CHAPTERS = gql`
    query TSUJI_BELL_CHAPTERS($mangaIds: [Int!]!) {
        chapters(filter: { mangaId: { in: $mangaIds } }) {
            nodes {
                id
                mangaId
                chapterNumber
                isRead
                fetchedAt
                sourceOrder
            }
        }
    }
`;
