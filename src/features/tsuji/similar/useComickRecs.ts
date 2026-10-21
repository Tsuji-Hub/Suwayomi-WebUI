/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { ComickRecommendation } from '@/features/tsuji/comick/comickCatalog.ts';
import { loadComickRecommendations } from '@/features/tsuji/comick/ComickService.ts';

/**
 * Comick's recommendations for the series (brief #15, always on), loaded once its AniList id and titles are known;
 * null while loading, none when Comick doesn't have it or the relay doesn't answer.
 */
export const useComickRecs = (anilistId: number | null, titles: string[]): ComickRecommendation[] | null => {
    const [result, setResult] = useState<{ anilistId: number; recommendations: ComickRecommendation[] } | null>(null);
    const titlesKey = titles.join('\n');

    useEffect(() => {
        if (anilistId === null || !titlesKey) {
            return undefined;
        }
        const controller = new AbortController();
        loadComickRecommendations(anilistId, titlesKey.split('\n'), controller.signal)
            .then((recommendations) => !controller.signal.aborted && setResult({ anilistId, recommendations }))
            .catch((error) => {
                if (controller.signal.aborted) {
                    return;
                }
                defaultPromiseErrorHandler('useComickRecs')(error);
                setResult({ anilistId, recommendations: [] });
            });
        return () => controller.abort();
    }, [anilistId, titlesKey]);

    return result?.anilistId === anilistId ? result.recommendations : null;
};
