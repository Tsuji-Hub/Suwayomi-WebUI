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
import { useCommentsSettings } from '@/features/tsuji/comments/useComments.ts';
import type { MuCategory, TagSuggestion } from '@/features/tsuji/tags/tagKeys.ts';
import { buildSuggestions } from '@/features/tsuji/tags/tagKeys.ts';
import { searchMuCategories } from '@/features/tsuji/tags/muService.ts';

const DEBOUNCE_MS = 300;
const MIN_MU_QUERY = 2;

/**
 * Suggestions for the tag search box, 300 ms after typing stops: the AniList catalog (local) merged with MU
 * categories (one relay request per new query, cached a week). MU being down just leaves the AniList ones.
 */
export const useTagSuggestions = (query: string, catalog: TagCatalog | null, showAdult: boolean) => {
    useCommentsSettings();
    const debounced = useDebounce(query.trim().toLowerCase(), DEBOUNCE_MS);
    const [mu, setMu] = useState<{ query: string; categories: MuCategory[] }>({ query: '', categories: [] });

    useEffect(() => {
        if (debounced.length < MIN_MU_QUERY) {
            return undefined;
        }
        const controller = new AbortController();
        searchMuCategories(debounced, controller.signal)
            .then((categories) => !controller.signal.aborted && setMu({ query: debounced, categories }))
            .catch(() => !controller.signal.aborted && setMu({ query: debounced, categories: [] }));
        return () => controller.abort();
    }, [debounced]);

    const suggestions: TagSuggestion[] = useMemo(
        () =>
            buildSuggestions({
                query: debounced,
                genres: catalog?.genres ?? [],
                tags: catalog?.tags ?? [],
                muCategories: mu.query === debounced ? mu.categories : [],
                showAdult,
            }),
        [debounced, catalog, mu, showAdult],
    );

    return {
        suggestions,
        isPending:
            debounced !== query.trim().toLowerCase() || (debounced.length >= MIN_MU_QUERY && mu.query !== debounced),
    };
};
