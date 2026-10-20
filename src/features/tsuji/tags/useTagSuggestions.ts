/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useMemo, useState } from 'react';
import { useDebounce } from '@/base/hooks/useDebounce.ts';
import type { TagCatalog } from '@/features/tsuji/discover/DiscoverService.ts';
import type { BakaTag } from '@/features/tsuji/tags/baka.ts';
import type { TagSuggestion } from '@/features/tsuji/tags/tagKeys.ts';
import { buildSuggestions } from '@/features/tsuji/tags/tagKeys.ts';
import { searchBakaTags } from '@/features/tsuji/tags/bakaService.ts';

const DEBOUNCE_MS = 300;
const MIN_BAKA_QUERY = 2;

/**
 * Suggestions for the tag search box, 300 ms after typing stops: the AniList catalog (local) merged with MangaBaka
 * tags (one request per new query, cached a week). MangaBaka being down just leaves the AniList ones.
 */
export const useTagSuggestions = (query: string, catalog: TagCatalog | null, showAdult: boolean) => {
    const debounced = useDebounce(query.trim().toLowerCase(), DEBOUNCE_MS);
    const [baka, setBaka] = useState<{ query: string; tags: BakaTag[] }>({ query: '', tags: [] });

    useEffect(() => {
        if (debounced.length < MIN_BAKA_QUERY) {
            return undefined;
        }
        const controller = new AbortController();
        searchBakaTags(debounced, controller.signal)
            .then((tags) => !controller.signal.aborted && setBaka({ query: debounced, tags }))
            .catch(() => !controller.signal.aborted && setBaka({ query: debounced, tags: [] }));
        return () => controller.abort();
    }, [debounced]);

    const suggestions: TagSuggestion[] = useMemo(
        () =>
            buildSuggestions({
                query: debounced,
                genres: catalog?.genres ?? [],
                tags: catalog?.tags ?? [],
                bakaTags: baka.query === debounced ? baka.tags : [],
                showAdult,
            }),
        [debounced, catalog, baka, showAdult],
    );

    return {
        suggestions,
        isPending:
            debounced !== query.trim().toLowerCase() ||
            (debounced.length >= MIN_BAKA_QUERY && baka.query !== debounced),
    };
};
