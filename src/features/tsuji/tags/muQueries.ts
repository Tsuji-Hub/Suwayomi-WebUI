/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { MEDIA_FIELDS } from '@/features/tsuji/recs/aniListQueries.ts';

/** AniList documents for matching MangaUpdates series (cards need the full media, plus genres and all names). */
const MATCH_FIELDS = `
    ${MEDIA_FIELDS}
    fragment TsujiMuMatch on Media { ...TsujiMedia genres synonyms title { native } }
`;

/** Up to 10 aliased title searches in one request: m0..m9, 3 hits each. */
export const buildMatchQuery = (count: number) => `
    ${MATCH_FIELDS}
    query TsujiMuMatch(${Array.from({ length: count }, (_, index) => `$t${index}: String`).join(', ')}) {
        ${Array.from(
            { length: count },
            (_, index) => `m${index}: Page(perPage: 3) { media(search: $t${index}, type: MANGA) { ...TsujiMuMatch } }`,
        ).join('\n        ')}
    }
`;

export const BY_IDS_QUERY = `
    ${MATCH_FIELDS}
    query TsujiMuById($ids: [Int]) {
        Page(perPage: 50) { media(id_in: $ids, type: MANGA) { ...TsujiMuMatch } }
    }
`;
