/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import gql from 'graphql-tag';

/** A series' AniList id for its drop rate chip and the library's Drop rate sort (brief #20). */
export const TSUJI_MANGA_DROP_FIELDS = gql`
    fragment TSUJI_MANGA_DROP_FIELDS on MangaType {
        id
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
`;

/** Spread into upstream's MANGA_LIBRARY_FIELDS (library + manga screen) for the series progress UI and drop chips. */
export const TSUJI_MANGA_PROGRESS_FIELDS = gql`
    ${TSUJI_MANGA_DROP_FIELDS}

    fragment TSUJI_MANGA_PROGRESS_FIELDS on MangaType {
        ...TSUJI_MANGA_DROP_FIELDS
        id
        latestReadChapter {
            id
            chapterNumber
        }
        highestNumberedChapter {
            id
            chapterNumber
        }
        chapters {
            totalCount
        }
    }
`;
