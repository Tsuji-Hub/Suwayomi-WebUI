/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
    AniListError,
    createAniListClient,
    getRateLimitWaitMs,
    isAniListTimeout,
} from '@/features/tsuji/services/AniListClient.ts';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

describe('getRateLimitWaitMs', () => {
    it('prefers Retry-After', () =>
        expect(getRateLimitWaitMs(new Headers({ 'Retry-After': '5', 'X-RateLimit-Reset': '99' }), 0)).toBe(5000));
    it('falls back to X-RateLimit-Reset', () =>
        expect(getRateLimitWaitMs(new Headers({ 'X-RateLimit-Reset': '30' }), 10_000)).toBe(20_000));
    it('falls back to a minute', () => expect(getRateLimitWaitMs(new Headers(), 0)).toBe(60_000));
});

describe('createAniListClient', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('pauses the shared queue until the reset after a 429, then retries', async () => {
        const responses = [json({}, 429, { 'X-RateLimit-Reset': '30' }), json({ data: { ok: true } })];
        const starts: number[] = [];
        const fetchFn = vi.fn(() => {
            starts.push(Date.now());
            return Promise.resolve(responses.shift()!);
        });
        const client = createAniListClient({ fetchFn, queue: new SpacedQueue(2100) });

        const result = client.request<{ ok: boolean }>('query', {});
        await vi.runAllTimersAsync();

        await expect(result).resolves.toEqual({ ok: true });
        expect(starts).toEqual([0, 30_000]);
    });

    it('gives up after two retries', async () => {
        const fetchFn = vi.fn(() => Promise.resolve(json({}, 429)));
        const client = createAniListClient({ fetchFn, queue: new SpacedQueue(2100) });

        const assertion = expect(client.request('query', {})).rejects.toBeInstanceOf(AniListError);
        await vi.runAllTimersAsync();

        await assertion;
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('throws GraphQL errors that come without data', async () => {
        const fetchFn = vi.fn(() => Promise.resolve(json({ data: null, errors: [{ message: 'Not Found.' }] }, 404)));
        const client = createAniListClient({ fetchFn, queue: new SpacedQueue(2100) });

        const assertion = expect(client.request('query', {})).rejects.toThrow('Not Found.');
        await vi.runAllTimersAsync();

        await assertion;
    });

    it('times out a hanging request with a distinct error', async () => {
        const fetchFn = vi.fn(
            (_input: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new Error('aborted')));
                }),
        );
        const client = createAniListClient({ fetchFn, queue: new SpacedQueue(2100) });

        let caught: unknown = null;
        const pending = client.request('query', {}, { timeoutMs: 4000 }).catch((error) => {
            caught = error;
        });
        await vi.advanceTimersByTimeAsync(3999);
        expect(caught).toBeNull();
        await vi.advanceTimersByTimeAsync(1);
        await pending;

        expect(isAniListTimeout(caught)).toBe(true);
    });

    it("forwards the caller's abort without reporting a timeout", async () => {
        const fetchFn = vi.fn(
            (_input: string, init: RequestInit) =>
                new Promise<Response>((_resolve, reject) => {
                    init.signal?.addEventListener('abort', () => reject(new Error('aborted by caller')));
                }),
        );
        const client = createAniListClient({ fetchFn, queue: new SpacedQueue(2100) });
        const controller = new AbortController();

        const assertion = expect(client.request('query', {}, { signal: controller.signal })).rejects.toThrow(
            'aborted by caller',
        );
        await vi.advanceTimersByTimeAsync(10);
        controller.abort();
        await assertion;
    });
});
