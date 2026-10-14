/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import type { CommentPage, CommentSource, ResolvedThread } from '@/features/tsuji/comments/CommentSource.ts';
import { CommentsRelayError } from '@/features/tsuji/comments/CommentSource.ts';
import type { ComickChapter, ComickSearchResult } from '@/features/tsuji/comments/comick.ts';
import {
    findChapterKey,
    mapComickComment,
    parseSeriesKey,
    pickBestMatch,
    reduceChapterMap,
    scoreSearchResults,
} from '@/features/tsuji/comments/comick.ts';
import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';

/** Comick allows ~20 requests a minute (the relay 30): one every 3 s after a burst of 3. */
const COMICK_SPACING_MS = 3000;
const COMICK_BURST = 3;
export const RELAY_TIMEOUT_MS = 5000;

const DAY_MS = 24 * 60 * 60 * 1000;
export const MATCH_TTL_MS = 7 * DAY_MS;
export const CHAPTER_MAP_TTL_MS = DAY_MS;
export const COMMENTS_TTL_MS = 2 * 60 * 1000;

export type CommentsCache = {
    get: <T>(key: string) => T | null;
    set: <T>(key: string, value: T, ttlMs: number) => void;
};

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;

/** HTTP GET through the relay with a 5 s deadline; anything but an answer from Comick is a relay error. */
export const createRelayClient = ({
    getBaseUrl,
    fetchFn = (input, init) => fetch(input, init),
    queue = new SpacedQueue(COMICK_SPACING_MS, { burst: COMICK_BURST }),
    timeoutMs = RELAY_TIMEOUT_MS,
}: {
    getBaseUrl: () => string;
    fetchFn?: FetchFn;
    queue?: SpacedQueue;
    timeoutMs?: number;
}) => ({
    /** JSON body, or null for a 404 (Comick has no such comic / chapter). */
    get: <T>(path: string, signal: AbortSignal): Promise<T | null> =>
        queue.run(async () => {
            const controller = new AbortController();
            const abort = () => controller.abort(signal.reason);
            signal.addEventListener('abort', abort, { once: true });
            const timer = setTimeout(() => controller.abort(new CommentsRelayError('timeout')), timeoutMs);

            try {
                const response = await fetchFn(`${getBaseUrl().replace(/\/+$/, '')}/comick${path}`, {
                    signal: controller.signal,
                    headers: { Accept: 'application/json' },
                });
                if (response.status === 404) {
                    return null;
                }
                if (!response.ok) {
                    throw new CommentsRelayError(`relay answered ${response.status}`);
                }
                return (await response.json()) as T;
            } catch (error) {
                if (signal.aborted) {
                    throw signal.reason ?? error;
                }
                throw error instanceof CommentsRelayError ? error : new CommentsRelayError(String(error));
            } finally {
                clearTimeout(timer);
                signal.removeEventListener('abort', abort);
            }
        }, signal),
});

export type RelayClient = ReturnType<typeof createRelayClient>;

const searchPath = (query: string) => `/v1.0/search?q=${encodeURIComponent(query)}&limit=10&t=false`;

/** Comick as a CommentSource, with its caches (match per title 7 days, chapter map 24 h, comments 2 min). */
export const createComickSource = ({ client, cache }: { client: RelayClient; cache: CommentsCache }): CommentSource => {
    const loadChapterMap = async (hid: string, signal: AbortSignal) => {
        const key = `comments:chapters:v1:${hid}`;
        const cached = cache.get<Record<string, string>>(key);
        if (cached) {
            return cached;
        }
        const response = await client.get<{ chapters?: ComickChapter[] | null }>(
            `/comic/${encodeURIComponent(hid)}/chapters?lang=en&limit=100000`,
            signal,
        );
        const map = reduceChapterMap(response?.chapters ?? []);
        cache.set(key, map, CHAPTER_MAP_TTL_MS);
        return map;
    };

    return {
        id: 'comick',
        name: 'Comick',

        resolveSeries: async (titles, signal) => {
            const query = titles.find((title) => normalizeTitle(title) !== '') ?? titles[0];
            if (!query) {
                return null;
            }
            const key = `comments:match:v1:${normalizeTitle(query) || query}`;
            const cached = cache.get<{ seriesKey: string; title: string } | { none: true }>(key);
            if (cached) {
                return 'none' in cached ? null : cached;
            }
            const results = (await client.get<ComickSearchResult[]>(searchPath(query), signal)) ?? [];
            const best = pickBestMatch(titles, results);
            cache.set(key, best ? { seriesKey: best.seriesKey, title: best.title } : { none: true }, MATCH_TTL_MS);
            return best ? { seriesKey: best.seriesKey, title: best.title } : null;
        },

        searchSeries: async (query, signal) =>
            scoreSearchResults([query], (await client.get<ComickSearchResult[]>(searchPath(query), signal)) ?? []),

        thread: async (seriesKey, chapterNumber, signal): Promise<ResolvedThread | null> => {
            const series = parseSeriesKey(seriesKey);
            if (!series) {
                return null;
            }
            const map = await loadChapterMap(series.hid, signal);
            const chapterKey = findChapterKey(map, chapterNumber);
            return chapterKey ? { seriesKey, chapterKey, threadKey: map[chapterKey] } : null;
        },

        comments: async (thread, _cursor, signal): Promise<CommentPage> => {
            const series = parseSeriesKey(thread.seriesKey);
            const key = `comments:thread:v1:${thread.threadKey}`;
            const cached = cache.get<CommentPage>(key);
            if (cached) {
                return cached;
            }
            const response = await client.get<{ comments?: Parameters<typeof mapComickComment>[0][] | null }>(
                `/comment/chapter/${encodeURIComponent(thread.threadKey)}?lang=en&comic-id=${series?.id ?? ''}&chap=${encodeURIComponent(thread.chapterKey)}`,
                signal,
            );
            const page: CommentPage = { comments: (response?.comments ?? []).map(mapComickComment), nextCursor: null };
            cache.set(key, page, COMMENTS_TTL_MS);
            return page;
        },
    };
};
