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
import { loadComickRecInfo, loadComickRecommendations } from '@/features/tsuji/comick/ComickService.ts';

/** Recommendations looked up (by votes): the ones Similar can show. */
const MAX_RESOLVED = 20;

/**
 * A recommendation as Similar shows it (brief #21): Comick's entry carries no AniList id, status or chapter date, so
 * each is looked up once (a search by its title, cached a week); the card then has the AniList id (the hide rules and
 * the dedupe work on it), the status and the latest chapter date. Unresolved ones stay Comick-only cards.
 */
const resolveRecommendations = async (
    recommendations: ComickRecommendation[],
    signal: AbortSignal,
): Promise<ComickRecommendation[]> => {
    const top = [...recommendations].sort((a, b) => b.votes - a.votes).slice(0, MAX_RESOLVED);
    const infos = await Promise.all(
        top.map(({ media }) => {
            const slug = media.siteUrl?.split('/comic/')[1];
            const title = media.title?.romaji ?? media.title?.english ?? media.title?.userPreferred;
            return slug && title ? loadComickRecInfo(slug, title, signal).catch(() => null) : null;
        }),
    );
    return top.map((recommendation, index) => {
        const info = infos[index];
        if (!info) {
            return recommendation;
        }
        return {
            ...recommendation,
            media: {
                ...recommendation.media,
                // Comick's linked entry for the same series: its title, page and cover (the AniList id is its).
                ...(info.twin ?? {}),
                id: info.anilistId ?? recommendation.media.id,
                status: info.status ?? recommendation.media.status,
                lastChapterAt: info.lastChapterAt,
            },
        };
    });
};

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
            .then((recommendations) => resolveRecommendations(recommendations, controller.signal))
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
