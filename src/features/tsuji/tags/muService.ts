/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { BY_IDS_QUERY, buildMatchQuery } from '@/features/tsuji/tags/muQueries.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getCommentsRelayUrl } from '@/features/tsuji/comments/commentsService.ts';
import type { AniListCandidate, MuSeries, MuSeriesQuery } from '@/features/tsuji/tags/muSearch.ts';
import { parseMuCategorySearch, parseMuSeriesSearch, pickAniListMatch } from '@/features/tsuji/tags/muSearch.ts';
import type { MuCategory } from '@/features/tsuji/tags/tagKeys.ts';

/*
 * MangaUpdates through the relay (`<relay>/mangaupdates/`: MU answers 403 to browser requests; the relay strips
 * Origin / Referer / cookies, caches an hour and allows POST only on the two search endpoints). Own budget of
 * 20/min client side, separate from AniList's.
 */

const MU_SPACING_MS = 3000;
const MU_BURST = 3;
const MU_TIMEOUT_MS = 8000;
const CATEGORY_TTL_MS = 7 * DAY_MS;
const MATCH_TTL_MS = 30 * DAY_MS;
const MATCH_BATCH = 10;

const muQueue = new SpacedQueue(MU_SPACING_MS, { burst: MU_BURST });

export class MuError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'MuError';
    }
}

const postMu = (path: string, body: unknown, signal?: AbortSignal): Promise<unknown> =>
    muQueue.run(async () => {
        const controller = new AbortController();
        const forward = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', forward, { once: true });
        const timer = setTimeout(
            () => controller.abort(new MuError('MangaUpdates did not answer in time')),
            MU_TIMEOUT_MS,
        );
        try {
            const response = await fetch(`${getCommentsRelayUrl().replace(/\/+$/, '')}/mangaupdates/${path}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            if (!response.ok) {
                throw new MuError(`MangaUpdates answered ${response.status}`);
            }
            return await response.json();
        } catch (error) {
            if (signal?.aborted) {
                throw signal.reason ?? error;
            }
            throw error instanceof MuError ? error : new MuError(String(error));
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', forward);
        }
    }, signal);

/** MU categories containing `query` (cached a week per query). */
export const searchMuCategories = async (query: string, signal?: AbortSignal): Promise<MuCategory[]> => {
    const key = `mu:cats:v1:${query.trim().toLowerCase()}`;
    const cached = TsujiCache.get<MuCategory[]>(key);
    if (cached) {
        return cached;
    }
    const categories = parseMuCategorySearch(
        await postMu('v1/categories/search', { search: query.trim(), perpage: 50 }, signal),
    );
    TsujiCache.set(key, categories, CATEGORY_TTL_MS);
    return categories;
};

const SERIES_MEMO_MS = 15 * 60 * 1000;
const seriesMemo = new Map<string, { at: number; result: Promise<ReturnType<typeof parseMuSeriesSearch>> }>();

/** The promise, given up on (not cancelled) when the signal aborts. */
const untilAborted = <T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> =>
    signal
        ? new Promise<T>((resolve, reject) => {
              if (signal.aborted) {
                  reject(signal.reason);
                  return;
              }
              const abort = () => reject(signal.reason);
              signal.addEventListener('abort', abort, { once: true });
              promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
          })
        : promise;

/**
 * One MU series search; an identical body within 15 minutes (also while in flight) is answered from memory, so a
 * feed that resets with the same selection never asks MU twice. The request itself outlives an aborted caller, so
 * the next caller with the same body picks it up instead of asking again.
 */
export const searchMuSeries = (query: MuSeriesQuery, signal?: AbortSignal) => {
    const key = JSON.stringify(query);
    const memo = seriesMemo.get(key);
    if (memo && Date.now() - memo.at < SERIES_MEMO_MS) {
        return untilAborted(memo.result, signal);
    }
    const result = postMu('v1/series/search', query).then(parseMuSeriesSearch);
    seriesMemo.set(key, { at: Date.now(), result });
    result.catch(() => seriesMemo.delete(key));
    return untilAborted(result, signal);
};

type PageResponse = { media: AniListCandidate[] | null } | null;

// v2: exact names are tie-broken by country and year (v1 verdicts could be wrong or empty for colliding names).
const matchKey = (seriesId: number) => `mu:match:v2:${seriesId}`;
type CachedMatch = { id: number | null };

/** Matches of this tab, with the media (cards need it): no AniList request at all for a series seen before. */
const matchMemo = new Map<number, RecMedia | null>();

/**
 * AniList media for MU series (null = no match), in the given order (the visible cards first), reported batch by
 * batch through `onBatch` so cards can fill in as matches land. Known matches come from memory, cached ids
 * (30 days) from one id_in request, the rest from 10 titles per aliased request through the shared AniList queue.
 */
export const matchMuSeries = async (
    series: MuSeries[],
    signal?: AbortSignal,
    onBatch?: (matches: Map<number, RecMedia | null>) => void,
): Promise<Map<number, RecMedia | null>> => {
    const result = new Map<number, RecMedia | null>();
    const report = (batch: Map<number, RecMedia | null>) => {
        batch.forEach((media, seriesId) => {
            result.set(seriesId, media);
            matchMemo.set(seriesId, media);
        });
        if (batch.size) {
            onBatch?.(batch);
        }
    };

    const remembered = new Map<number, RecMedia | null>();
    const knownIds = new Map<number, number>();
    const unknown: MuSeries[] = [];
    series.forEach((each) => {
        if (matchMemo.has(each.seriesId)) {
            remembered.set(each.seriesId, matchMemo.get(each.seriesId) ?? null);
            return;
        }
        const cached = TsujiCache.get<CachedMatch>(matchKey(each.seriesId));
        if (!cached) {
            unknown.push(each);
        } else if (cached.id === null) {
            remembered.set(each.seriesId, null);
        } else {
            knownIds.set(each.seriesId, cached.id);
        }
    });
    report(remembered);

    if (knownIds.size) {
        const data = await aniList.request<{ Page: PageResponse }>(
            BY_IDS_QUERY,
            { ids: [...new Set(knownIds.values())] },
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        );
        const byId = new Map((data.Page?.media ?? []).map((media) => [media.id, media]));
        report(new Map([...knownIds].map(([seriesId, id]) => [seriesId, byId.get(id) ?? null])));
    }

    for (let start = 0; start < unknown.length; start += MATCH_BATCH) {
        const batch = unknown.slice(start, start + MATCH_BATCH);
        // oxlint-disable-next-line no-await-in-loop
        const data = await aniList.request<Record<string, PageResponse>>(
            buildMatchQuery(batch.length),
            Object.fromEntries(batch.map((each, index) => [`t${index}`, each.title])),
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        );
        report(
            new Map(
                batch.map((each, index) => {
                    const match = pickAniListMatch(each, data[`m${index}`]?.media ?? []);
                    TsujiCache.set<CachedMatch>(matchKey(each.seriesId), { id: match?.id ?? null }, MATCH_TTL_MS);
                    return [each.seriesId, match];
                }),
            ),
        );
    }
    return result;
};
