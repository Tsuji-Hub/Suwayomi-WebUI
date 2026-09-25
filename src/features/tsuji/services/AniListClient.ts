/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';

const ANILIST_URL = 'https://graphql.anilist.co';

/** AniList is running degraded at 30 req/min; 2.1 s spacing keeps one tab under it. */
const ANILIST_SPACING_MS = 2100;
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

export const createAniListClient = ({
    fetchFn = (input, init) => fetch(input, init),
    queue = new SpacedQueue(ANILIST_SPACING_MS),
    now = Date.now,
}: { fetchFn?: FetchFn; queue?: SpacedQueue; now?: () => number } = {}) => {
    const request = async <T>(
        query: string,
        variables: Record<string, unknown>,
        signal?: AbortSignal,
        attempt: number = 0,
    ): Promise<T> => {
        const response = await queue.run(
            () =>
                fetchFn(ANILIST_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
                    body: JSON.stringify({ query, variables }),
                    signal,
                }),
            signal,
        );

        if (response.status === 429) {
            queue.pauseUntil(now() + getRateLimitWaitMs(response.headers, now()));

            if (attempt >= MAX_RATE_LIMIT_RETRIES) {
                throw new AniListError('AniList rate limit reached', 429);
            }

            return request<T>(query, variables, signal, attempt + 1);
        }

        if (response.headers.get('X-RateLimit-Remaining') === '0') {
            queue.pauseUntil(now() + getRateLimitWaitMs(response.headers, now()));
        }

        const body: AniListBody<T> = await response.json().catch(() => null);
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

/** One shared client (and queue) for every AniList call in the tab: Similar, Discover, id resolution. */
export const aniList = createAniListClient();
