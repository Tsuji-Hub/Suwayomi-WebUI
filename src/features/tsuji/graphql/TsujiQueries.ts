/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import gql from 'graphql-tag';

/** Library titles + tracker ids, for "Hide what's in my library" on Discover, Similar and For You. */
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
                meta {
                    mangaId
                    key
                    value
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

/**
 * Library series whose title contains `title`, with their meta and last read chapter: the English series an MTL
 * series ("<title> [MTL]") translates, found by its `tsuji_raw_links` (brief #19).
 */
export const TSUJI_MTL_PARENTS = gql`
    query TSUJI_MTL_PARENTS($title: String!) {
        mangas(condition: { inLibrary: true }, filter: { title: { includesInsensitive: $title } }) {
            nodes {
                id
                title
                meta {
                    mangaId
                    key
                    value
                }
                lastReadChapter {
                    id
                    lastReadAt
                }
            }
        }
    }
`;
