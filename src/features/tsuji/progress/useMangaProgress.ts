/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useFragment } from '@apollo/client/react';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import type { TsujiMangaProgressFieldsFragment } from '@/lib/graphql/generated/graphql.ts';
import { TSUJI_MANGA_PROGRESS_FIELDS } from '@/features/tsuji/graphql/TsujiFragments.ts';
import type { SeriesProgress } from '@/features/tsuji/progress/progress.ts';
import { getSeriesProgress } from '@/features/tsuji/progress/progress.ts';

/** Reads the progress fields (fetched by the library/manga queries) straight from the Apollo cache. */
export const useMangaProgress = (mangaId: number): SeriesProgress | null => {
    const { data, complete } = useFragment<TsujiMangaProgressFieldsFragment>({
        fragment: TSUJI_MANGA_PROGRESS_FIELDS,
        fragmentName: 'TSUJI_MANGA_PROGRESS_FIELDS',
        from: { __typename: 'MangaType', id: mangaId },
        client: requestManager.graphQLClient.client,
    });

    if (!complete) {
        return null;
    }

    return getSeriesProgress({
        latestReadNumber: data.latestReadChapter?.chapterNumber,
        highestNumber: data.highestNumberedChapter?.chapterNumber,
        totalCount: data.chapters.totalCount,
    });
};
