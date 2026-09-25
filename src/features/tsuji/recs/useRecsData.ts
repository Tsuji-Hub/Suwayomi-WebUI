/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useMemo } from 'react';
import { useQuery } from '@apollo/client/react';
import { useNavigate } from 'react-router-dom';
import { requestManager } from '@/lib/requests/RequestManager.ts';
import type { TsujiLibraryIndexQuery } from '@/lib/graphql/generated/graphql.ts';
import { AppRoutes } from '@/base/AppRoute.constants.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { TSUJI_LIBRARY_INDEX } from '@/features/tsuji/graphql/TsujiQueries.ts';
import type { LibraryIndex, RecFilters } from '@/features/tsuji/recs/filters.ts';
import { buildLibraryIndex, EMPTY_LIBRARY_INDEX, parseRecFilters } from '@/features/tsuji/recs/filters.ts';
import { getDisplayTitle } from '@/features/tsuji/recs/media.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { setTsujiGlobalMeta, useTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';

/**
 * Library titles + tracker ids for "hide in library"; null until the first result is in. On error it falls back to
 * an empty index (nothing hidden) rather than leaving Similar/Discover on a skeleton.
 */
export const useLibraryIndex = (): LibraryIndex | null => {
    const { data, error } = useQuery<TsujiLibraryIndexQuery>(TSUJI_LIBRARY_INDEX, {
        client: requestManager.graphQLClient.client,
        fetchPolicy: 'cache-and-network',
    });

    return useMemo(() => {
        if (data) {
            return buildLibraryIndex(data.mangas.nodes);
        }

        return error ? EMPTY_LIBRARY_INDEX : null;
    }, [data, error]);
};

/** Shared Similar/Discover filters, persisted as JSON in global meta. */
export const useRecFilters = (): [RecFilters, (filters: RecFilters) => void] => {
    const raw = useTsujiGlobalMeta()[TSUJI_META_KEYS.recFilters];
    const filters = useMemo(() => parseRecFilters(raw), [raw]);
    const setFilters = useCallback((next: RecFilters) => {
        setTsujiGlobalMeta(TSUJI_META_KEYS.recFilters, JSON.stringify(next));
    }, []);

    return [filters, setFilters];
};

/** Opens upstream's global search prefilled with the title, across all sources (not only pinned). */
export const useFindToRead = () => {
    const navigate = useNavigate();

    return useCallback(
        (media: Pick<RecMedia, 'title'>) =>
            navigate(AppRoutes.sources.children.searchAll.path(getDisplayTitle(media)), {
                state: AppRoutes.sources.children.searchAll.state({ shouldShowOnlyPinnedSources: false }),
            }),
        [navigate],
    );
};
