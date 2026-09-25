/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecSource } from '@/features/tsuji/recs/Recs.types.ts';
import { jikanGet } from '@/features/tsuji/services/JikanClient.ts';

/** AniList's Page caps idMal_in lookups at 25 per request (Hydrate query). */
const MAX_REFS = 25;

type JikanRecommendationsResponse = { data?: { entry?: { mal_id?: number }; votes?: number }[] };

export const JikanSource: RecSource = {
    id: 'mal',
    fetchRefs: async ({ idMal, signal }) => {
        if (!idMal) {
            return [];
        }

        const { data = [] } = await jikanGet<JikanRecommendationsResponse>(`/manga/${idMal}/recommendations`, signal);

        return data
            .filter((recommendation) => Number.isInteger(recommendation.entry?.mal_id))
            .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))
            .slice(0, MAX_REFS)
            .map((recommendation) => ({
                source: 'mal' as const,
                malId: recommendation.entry!.mal_id!,
                votes: recommendation.votes,
            }));
    },
};

/** External sources run in parallel after the AniList seed; add proxied MangaUpdates/MangaDex/Comick here. */
export const EXTERNAL_REC_SOURCES: RecSource[] = [JikanSource];
