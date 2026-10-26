/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { GqlMetaHolder } from '@/features/metadata/Metadata.types.ts';
import { GET_MANGA_TRACK_RECORDS } from '@/lib/graphql/manga/MangaQuery.ts';
import type { GetMangaTrackRecordsQuery } from '@/lib/graphql/generated/graphql.ts';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import { getMangaAniListId } from '@/features/tsuji/drops/drops.ts';

export { getMangaAniListId } from '@/features/tsuji/drops/drops.ts';

/** The series page's AniList id (the track records come from the query Similar already makes). */
export const useMangaAniListId = (manga: { id: number } & GqlMetaHolder): number | null => {
    const trackRecords = requestManager.useGetManga<GetMangaTrackRecordsQuery>(GET_MANGA_TRACK_RECORDS, manga.id).data
        ?.manga.trackRecords;
    return getMangaAniListId({ meta: manga.meta, trackRecords });
};
