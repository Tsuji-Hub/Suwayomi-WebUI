/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { ParallelQueue, SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { MEDIA_FIELDS } from '@/features/tsuji/recs/aniListQueries.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { BakaSeries, BakaSeriesTag, BakaTag } from '@/features/tsuji/tags/baka.ts';
import {
    getBakaFamilies,
    parseBakaSearch,
    parseBakaSeries,
    parseBakaSeriesTags,
    parseBakaSource,
    parseBakaTags,
} from '@/features/tsuji/tags/baka.ts';

/*
 * MangaBaka's public API, straight from the browser (it answers CORS with `*`; no relay, no login, never a token).
 * Limits: search 30/min, everything else 180/min, per IP; cached answers don't count. Client side: up to 4 searches
 * at once, tags one per 0.5 s; a 429 pauses the whole queue (Retry-After, else 5 s) and the request retries twice.
 * Requests
 * carry no custom header: a browser can't set User-Agent, and an extra header would need a CORS preflight; the
 * Origin header names the Suwayomi host.
 */

export const BAKA_API = 'https://api.mangabaka.org';
const TIMEOUT_MS = 8000;
const SEARCH_TTL_MS = 60 * 60 * 1000;
const TAGS_TTL_MS = 7 * DAY_MS;
const MAX_429_RETRIES = 2;
const DEFAULT_RETRY_MS = 5000;

// Sub-searches of one selection go out together (brief #11: 16 one after another took ~40 s), like Makimono.
const searchQueue = new ParallelQueue(4);
// Series lookups by AniList id (For You's family row asks 60 at once; 180/min allows it): 6 at a time.
const lookupQueue = new ParallelQueue(6);
const defaultQueue = new SpacedQueue(500, { burst: 5 });

export class BakaError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BakaError';
    }
}

const getJson = async (
    queue: SpacedQueue | ParallelQueue,
    path: string,
    signal?: AbortSignal,
    attempt = 0,
): Promise<unknown> => {
    const response = await queue.run(async () => {
        const controller = new AbortController();
        const forward = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', forward, { once: true });
        const timer = setTimeout(() => controller.abort(new BakaError('MangaBaka did not answer in time')), TIMEOUT_MS);
        try {
            return await fetch(`${BAKA_API}${path}`, {
                headers: { Accept: 'application/json' },
                credentials: 'omit',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            });
        } catch (error) {
            if (signal?.aborted) {
                throw signal.reason ?? error;
            }
            throw error instanceof BakaError ? error : new BakaError(String(error));
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', forward);
        }
    }, signal);
    if (response.status === 429 && attempt < MAX_429_RETRIES) {
        const retryAfter = Number(response.headers.get('retry-after'));
        // Shared back-off: every queued request waits, not only this one.
        queue.pauseUntil(
            Date.now() + (Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : DEFAULT_RETRY_MS),
        );
        return getJson(queue, path, signal, attempt + 1);
    }
    if (!response.ok) {
        throw new BakaError(`MangaBaka answered ${response.status}`);
    }
    return response.json();
};

/** MangaBaka tags whose name contains the query, cached a week per query. */
export const searchBakaTags = async (query: string, signal?: AbortSignal): Promise<BakaTag[]> => {
    const wanted = query.trim().toLowerCase();
    const key = `baka:tags:v1:${wanted}`;
    const cached = TsujiCache.get<BakaTag[]>(key);
    if (cached) {
        return cached;
    }
    const tags = parseBakaTags(await getJson(defaultQueue, `/v1/tags?q=${encodeURIComponent(wanted)}`, signal));
    TsujiCache.set(key, tags, TAGS_TTL_MS);
    return tags;
};

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

/** Rows per search page; a 400 for 50 (MangaBaka's documented maximum is unclear) drops it to 25 for the session. */
let searchLimit = 50;
export const getSearchLimit = () => searchLimit;

type SearchPage = { series: BakaSeries[]; hasNextPage: boolean };
const searchMemo = new Map<string, Promise<SearchPage>>();

/**
 * One search page (`query` from buildBakaSearch), cached an hour; an identical query is answered from memory, also
 * while in flight, and the request outlives an aborted caller so the next one picks it up.
 */
export const searchBakaSeries = (query: string, signal?: AbortSignal): Promise<SearchPage> => {
    const key = `baka:search:v1:${query}`;
    const cached = TsujiCache.get<SearchPage>(key);
    if (cached) {
        return Promise.resolve(cached);
    }
    let result = searchMemo.get(key);
    if (!result) {
        const limit = Number(new URLSearchParams(query).get('limit')) || searchLimit;
        result = getJson(searchQueue, `/v1/series/search?${query}`).then((json) => parseBakaSearch(json, limit));
        searchMemo.set(key, result);
        result.then(
            (page) => {
                TsujiCache.set(key, page, SEARCH_TTL_MS);
                searchMemo.delete(key);
            },
            () => searchMemo.delete(key),
        );
    }
    return untilAborted(result, signal).catch((error) => {
        if (error instanceof BakaError && error.message.endsWith(' 400') && searchLimit > 25) {
            searchLimit = 25;
        }
        throw error;
    });
};

/**
 * The MangaBaka series behind an AniList id, with its tags (null = MangaBaka doesn't know it). One request (180/min,
 * 6 at a time); callers cache what they keep.
 */
export const lookupBakaSource = async (
    anilistId: number,
    signal?: AbortSignal,
): Promise<{ series: BakaSeries; tags: BakaSeriesTag[] } | null> => {
    try {
        return parseBakaSource(await getJson(lookupQueue, `/v1/source/anilist/${anilistId}`, signal));
    } catch (error) {
        if (error instanceof BakaError && error.message.endsWith(' 404')) {
            return null;
        }
        throw error;
    }
};

/** A series' tags rarely change. */
const FAMILIES_TTL_MS = 30 * DAY_MS;

/** The MangaBaka families (BAKA_FAMILIES keys) of the series behind an AniList id, cached a month. */
export const getBakaFamiliesOf = async (anilistId: number, signal?: AbortSignal): Promise<string[]> => {
    const key = `baka:families:v1:${anilistId}`;
    const cached = TsujiCache.get<string[]>(key);
    if (cached) {
        return cached;
    }
    const found = await lookupBakaSource(anilistId, signal);
    const families = found ? getBakaFamilies(found.tags) : [];
    TsujiCache.set(key, families, FAMILIES_TTL_MS);
    return families;
};

/** One search page (`query` from buildBakaSearch) with each series' tags; not cached (callers keep the result). */
export const searchBakaSeriesWithTags = async (
    query: string,
    signal?: AbortSignal,
): Promise<{ series: BakaSeries; tags: BakaSeriesTag[] }[]> => {
    const { data } = (await getJson(searchQueue, `/v1/series/search?${query}`, signal)) as { data?: unknown };
    return (Array.isArray(data) ? data : []).flatMap((row) => {
        const series = parseBakaSeries(row);
        return series ? [{ series, tags: parseBakaSeriesTags(row) }] : [];
    });
};

/** AniList media (cards' details, the preview) for MangaBaka cards: one `id_in` request per page, no searches. */
export const DETAILS_QUERY = `
    ${MEDIA_FIELDS}
    query TsujiBakaDetails($ids: [Int]) {
        Page(perPage: 50) { media(id_in: $ids, type: MANGA) { ...TsujiMedia genres } }
    }
`;

/** Details for these AniList ids (null = AniList has no such manga), kept for the tab. */
const detailsMemo = new Map<number, RecMedia | null>();

export const fetchAniListDetails = async (
    ids: number[],
    signal?: AbortSignal,
): Promise<Map<number, RecMedia | null>> => {
    const result = new Map<number, RecMedia | null>();
    const missing = ids.filter((id) => {
        if (detailsMemo.has(id)) {
            result.set(id, detailsMemo.get(id) ?? null);
            return false;
        }
        return true;
    });
    if (missing.length) {
        const data = await aniList.request<{ Page: { media: RecMedia[] | null } | null }>(
            DETAILS_QUERY,
            { ids: missing.slice(0, 50) },
            { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
        );
        const byId = new Map((data.Page?.media ?? []).map((media) => [media.id, media]));
        missing.slice(0, 50).forEach((id) => {
            const media = byId.get(id) ?? null;
            detailsMemo.set(id, media);
            result.set(id, media);
        });
    }
    return result;
};
