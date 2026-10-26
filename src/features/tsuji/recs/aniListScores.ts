/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { AniListHealth } from '@/features/tsuji/services/aniListHealth.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { AniListScore } from '@/features/tsuji/recs/mergedScore.ts';

/** AniList scores of Comick cards (brief #21): one `id_in` request per rail (50 ids), kept a day. */

export const SCORES_QUERY = `
    query TsujiScores($ids: [Int]) {
        Page(perPage: 50) { media(id_in: $ids, type: MANGA) { id averageScore meanScore popularity } }
    }
`;

const BATCH = 50;
const TTL_MS = DAY_MS;
const keyOf = (id: number) => `al:score:v1:${id}`;
const EMPTY = new Map<number, AniListScore>();

type ScoresResponse = { Page: { media: ({ id: number } & AniListScore)[] | null } | null };

const loadScores = async (ids: number[]): Promise<Map<number, AniListScore>> => {
    const scores = new Map<number, AniListScore>();
    const missing = ids.filter((id) => {
        const cached = TsujiCache.get<AniListScore>(keyOf(id));
        if (cached) {
            scores.set(id, cached);
        }
        return !cached;
    });
    if (!missing.length || AniListHealth.isDown()) {
        return scores;
    }
    const batches = Array.from({ length: Math.ceil(missing.length / BATCH) }, (_, index) =>
        missing.slice(index * BATCH, (index + 1) * BATCH),
    );
    await Promise.all(
        batches.map((batch) =>
            aniList
                .request<ScoresResponse>(SCORES_QUERY, { ids: batch }, { timeoutMs: ANILIST_TIMEOUT_MS.slow })
                .then(({ Page }) => {
                    const found = new Map((Page?.media ?? []).map((media) => [media.id, media]));
                    // An id AniList doesn't return is kept too (no score), so it isn't asked again for a day.
                    batch.forEach((id) => {
                        const media = found.get(id);
                        const score = {
                            averageScore: media?.averageScore ?? null,
                            meanScore: media?.meanScore ?? null,
                            popularity: media?.popularity ?? null,
                        };
                        scores.set(id, score);
                        TsujiCache.set(keyOf(id), score, TTL_MS);
                    });
                })
                // No AniList scores: the cards keep Comick's, marked "CK".
                .catch(() => {}),
        ),
    );
    return scores;
};

/** AniList's score, mean score and popularity of these ids (empty until in; never blocks the rail). */
export const useAniListScores = (ids: number[]): Map<number, AniListScore> => {
    const key = [...new Set(ids)].sort((a, b) => a - b).join(',');
    const [result, setResult] = useState<{ key: string; scores: Map<number, AniListScore> }>({
        key: '',
        scores: new Map(),
    });

    useEffect(() => {
        if (!key) {
            return undefined;
        }
        let isCurrent = true;
        loadScores(key.split(',').map(Number)).then((scores) => isCurrent && setResult({ key, scores }));
        return () => {
            isCurrent = false;
        };
    }, [key]);

    return result.key === key ? result.scores : EMPTY;
};
