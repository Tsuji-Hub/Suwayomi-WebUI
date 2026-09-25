/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';

const ANILIST_URL = 'https://graphql.anilist.co';

/**
 * AniList is running degraded at 30 req/min: a burst of 3 (Trending + Popular + your list on Discover open), then
 * one every 2.1 s keeps one tab under it.
 */
const ANILIST_SPACING_MS = 2100;
const ANILIST_BURST = 3;
const DEFAULT_RATE_LIMIT_WAIT_MS = 60_000;
const MAX_RATE_LIMIT_RETRIES = 2;

export class AniListError extends Error {
    constructor(
        message: string,
        readonly status: number,
    ) {
        super(message);
        this.name = 'AniListError';
    }
}

type FetchFn = (input: string, init: RequestInit) => Promise<Response>;

type AniListBody<T> = { data?: T | null; errors?: { message?: string }[] } | null;

/**
 * AniList's CORS config only exposes X-RateLimit-Limit/Remaining/Reset, so Retry-After is usually unreadable
 * from the browser. Prefer it when present, then the reset timestamp, then a flat minute.
 */
export const getRateLimitWaitMs = (headers: Headers, now: number): number => {
    const retryAfterSeconds = Number(headers.get('Retry-After'));
    if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
        return retryAfterSeconds * 1000;
    }

    const resetEpochSeconds = Number(headers.get('X-RateLimit-Reset'));
    if (Number.isFinite(resetEpochSeconds) && resetEpochSeconds * 1000 > now) {
        return resetEpochSeconds * 1000 - now;
    }

    return DEFAULT_RATE_LIMIT_WAIT_MS;
};

/** Discover/Similar budget: first attempts and optional steps get `fast`; the last attempt of a chain gets `slow`. */
export const ANILIST_TIMEOUT_MS = { fast: 4000, slow: 12_000 } as const;

const TIMEOUT_STATUS = 408;

export const isAniListTimeout = (error: unknown): boolean =>
    error instanceof AniListError && error.status === TIMEOUT_STATUS;

export type AniListRequestOptions = { signal?: AbortSignal; timeoutMs?: number };

export const createAniListClient = ({
    fetchFn = (input, init) => fetch(input, init),
    queue = new SpacedQueue(ANILIST_SPACING_MS, { burst: ANILIST_BURST }),
    now = Date.now,
}: { fetchFn?: FetchFn; queue?: SpacedQueue; now?: () => number } = {}) => {
    /** The timeout starts when the request leaves the queue: rate-limit waits don't count against it. */
    const send = async <T>(
        query: string,
        variables: Record<string, unknown>,
        signal: AbortSignal | undefined,
        timeoutMs: number,
    ) => {
        // An already-aborted signal never fires 'abort' again, so check before sending.
        signal?.throwIfAborted();

        const controller = new AbortController();
        const forwardAbort = () => controller.abort(signal?.reason);
        signal?.addEventListener('abort', forwardAbort, { once: true });

        let hasTimedOut = false;
        const timer = setTimeout(() => {
            hasTimedOut = true;
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetchFn(ANILIST_URL, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                body: JSON.stringify({ query, variables }),
                signal: controller.signal,
            });
            const body: AniListBody<T> = await response.json().catch(() => null);

            signal?.throwIfAborted();
            if (hasTimedOut) {
                throw new AniListError(`AniList did not answer within ${timeoutMs / 1000} s`, TIMEOUT_STATUS);
            }

            return { response, body };
        } catch (error) {
            if (hasTimedOut) {
                throw new AniListError(`AniList did not answer within ${timeoutMs / 1000} s`, TIMEOUT_STATUS);
            }
            throw error;
        } finally {
            clearTimeout(timer);
            signal?.removeEventListener('abort', forwardAbort);
        }
    };

    const request = async <T>(
        query: string,
        variables: Record<string, unknown>,
        { signal, timeoutMs = ANILIST_TIMEOUT_MS.slow }: AniListRequestOptions = {},
        attempt: number = 0,
    ): Promise<T> => {
        const { response, body } = await queue.run(() => send<T>(query, variables, signal, timeoutMs), signal);

        if (response.status === 429) {
            queue.pauseUntil(now() + getRateLimitWaitMs(response.headers, now()));

            if (attempt >= MAX_RATE_LIMIT_RETRIES) {
                throw new AniListError('AniList rate limit reached', 429);
            }

            return request<T>(query, variables, { signal, timeoutMs }, attempt + 1);
        }

        if (response.headers.get('X-RateLimit-Remaining') === '0') {
            queue.pauseUntil(now() + getRateLimitWaitMs(response.headers, now()));
        }

        if (!response.ok || !body?.data) {
            throw new AniListError(
                body?.errors?.[0]?.message ?? `AniList request failed (${response.status})`,
                response.status,
            );
        }

        return body.data;
    };

    return { request };
};

/** One shared client (and queue) for every AniList call in the tab: Similar, Discover, id resolution, your list. */
export const aniList = createAniListClient();
