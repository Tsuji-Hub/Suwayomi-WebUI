/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import gql from 'graphql-tag';

/** Library titles + tracker ids, for "hide in library" on Similar and Discover. */
export const TSUJI_LIBRARY_INDEX = gql`
    query TSUJI_LIBRARY_INDEX {
        mangas(condition: { inLibrary: true }) {
            nodes {
                id
                title
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
