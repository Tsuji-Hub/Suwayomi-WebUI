/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { RECS_CACHE_TTL_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { HydrateResponse, SeedResponse } from '@/features/tsuji/recs/aniListQueries.ts';
import { HYDRATE_QUERY, SEED_QUERY } from '@/features/tsuji/recs/aniListQueries.ts';
import { getContentTags } from '@/features/tsuji/recs/media.ts';
import { mergeCandidates } from '@/features/tsuji/recs/merge.ts';
import type {
    RecCandidate,
    RecMedia,
    RecRef,
    RecSource,
    RecSourceId,
    RecTag,
} from '@/features/tsuji/recs/Recs.types.ts';
import { EXTERNAL_REC_SOURCES } from '@/features/tsuji/recs/sources/JikanSource.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';

const RECALL_TAG_COUNT = 3;
const EXTERNAL_SOURCE_TIMEOUT_MS = ANILIST_TIMEOUT_MS.fast;
const MAX_MAL_IDS = 25;
/** Synopses are only shown in a tooltip / preview; keep cached entries small (TsujiCache caps localStorage). */
const MAX_CACHED_DESCRIPTION = 500;
const MAX_CACHED_TAGS = 20;
/** A result missing a failed source is only cached briefly, so the next visit retries it. */
const PARTIAL_CACHE_TTL_MS = 60 * 60 * 1000;

export type SimilarData = {
    seedId: number;
    seedTags: RecTag[];
    candidates: RecCandidate[];
    /** Sources that contributed at least one candidate. */
    sources: RecSourceId[];
};

const cacheKey = (anilistId: number) => `similar:v1:${anilistId}`;

/** Runs one external source with its own deadline; hitting it aborts the source's requests too. */
const fetchWithDeadline = async (source: RecSource, anilistId: number, idMal: number | null, signal: AbortSignal) => {
    const controller = new AbortController();
    const forwardAbort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', forwardAbort, { once: true });
    const timer = setTimeout(
        () => controller.abort(new Error(`${source.id} timed out after ${EXTERNAL_SOURCE_TIMEOUT_MS} ms`)),
        EXTERNAL_SOURCE_TIMEOUT_MS,
    );

    try {
        return await source.fetchRefs({ anilistId, idMal, signal: controller.signal });
    } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', forwardAbort);
    }
};

const collectExternalRefs = async (anilistId: number, idMal: number | null, signal: AbortSignal) => {
    const results = await Promise.allSettled(
        EXTERNAL_REC_SOURCES.map((source) => fetchWithDeadline(source, anilistId, idMal, signal)),
    );

    // A failing source is skipped; the others still count.
    return {
        refs: results.flatMap((result) => (result.status === 'fulfilled' ? result.value : ([] as RecRef[]))),
        hasFailure: results.some((result) => result.status === 'rejected'),
    };
};

const trimForCache = (media: RecCandidate): RecCandidate => ({
    ...media,
    description: media.description?.slice(0, MAX_CACHED_DESCRIPTION) ?? null,
    // Low-rank tags barely move the cosine and are never shown; keep the strongest ones.
    tags: [...(media.tags ?? [])].sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0)).slice(0, MAX_CACHED_TAGS),
});

export const loadSimilar = async ({
    anilistId,
    force = false,
    signal,
}: {
    anilistId: number;
    force?: boolean;
    signal: AbortSignal;
}): Promise<SimilarData> => {
    if (!force) {
        const cached = TsujiCache.get<SimilarData>(cacheKey(anilistId));
        if (cached) {
            return cached;
        }
    }

    // The seed is required: without it there is nothing to rank against, so this failure propagates.
    const { Media: seed } = await aniList.request<SeedResponse>(
        SEED_QUERY,
        { id: anilistId },
        { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
    );
    if (!seed) {
        throw new Error(`AniList media ${anilistId} not found`);
    }

    const { refs, hasFailure: hasExternalFailure } = await collectExternalRefs(anilistId, seed.idMal, signal);
    signal.throwIfAborted();
    const malIds = [...new Set(refs.flatMap(({ malId }) => (malId ? [malId] : [])))].slice(0, MAX_MAL_IDS);
    const recallTags = getContentTags(seed)
        .slice(0, RECALL_TAG_COUNT)
        .map(({ name }) => name);

    let recall: RecMedia[] = [];
    let malMapped: RecMedia[] = [];
    let hasHydrateFailure = false;
    if (recallTags.length || malIds.length) {
        try {
            const hydrated = await aniList.request<HydrateResponse>(
                HYDRATE_QUERY,
                { tags: recallTags, withTags: recallTags.length > 0, malIds, withMal: malIds.length > 0 },
                { signal, timeoutMs: ANILIST_TIMEOUT_MS.fast },
            );
            recall = hydrated.recall?.media ?? [];
            malMapped = hydrated.mal?.media ?? [];
        } catch (error) {
            if (signal.aborted) {
                throw error;
            }
            // Recall and MAL mapping are optional: keep the AniList edges.
            hasHydrateFailure = true;
        }
    }

    const candidates = mergeCandidates({
        seedId: seed.id,
        edges: (seed.recommendations?.nodes ?? []).map(({ rating, mediaRecommendation }) => ({
            rating,
            media: mediaRecommendation,
        })),
        recall,
        malMapped,
    }).map(trimForCache);

    const data: SimilarData = {
        seedId: seed.id,
        seedTags: seed.tags ?? [],
        candidates,
        sources: (['anilist', 'mal', 'tags'] as RecSourceId[]).filter((source) =>
            candidates.some(({ sources }) => sources.includes(source)),
        ),
    };

    signal.throwIfAborted();
    const isPartial = hasExternalFailure || hasHydrateFailure;
    TsujiCache.set(cacheKey(anilistId), data, isPartial ? PARTIAL_CACHE_TTL_MS : RECS_CACHE_TTL_MS);

    return data;
};
