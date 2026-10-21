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
    isAniListDown,
    isAniListTimeout,
} from '@/features/tsuji/services/AniListClient.ts';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import { AniListHealth } from '@/features/tsuji/services/aniListHealth.ts';

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
    new Response(JSON.stringify(body), { status, headers });

describe('getRateLimitWaitMs', () => {
    it('prefers Retry-After', () =>
        expect(getRateLimitWaitMs(new Headers({ 'Retry-After': '5', 'X-RateLimit-Reset': '99' }), 0)).toBe(5000));
    it('falls back to X-RateLimit-Reset', () =>
        expect(getRateLimitWaitMs(new Headers({ 'X-RateLimit-Reset': '30' }), 10_000)).toBe(20_000));
    it('falls back to a minute', () => expect(getRateLimitWaitMs(new Headers(), 0)).toBe(60_000));
});

const clientAnswering = (response: () => Promise<Response>) =>
    createAniListClient({ fetchFn: vi.fn(response), queue: new SpacedQueue(0) });

describe('createAniListClient', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        AniListHealth.reset();
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

    it('AniList down (403 "temporarily disabled"): nothing more goes out but one probe every 5 minutes', async () => {
        vi.setSystemTime(1_000_000);
        const disabled = () =>
            json(
                {
                    data: null,
                    errors: [
                        { message: 'The AniList API has been temporarily disabled due to severe stability issues.' },
                    ],
                },
                403,
            );
        const fetchFn = vi.fn(() => Promise.resolve(disabled()));
        const client = createAniListClient({ fetchFn, queue: new SpacedQueue(0) });

        const first = expect(client.request('query', {})).rejects.toThrow('temporarily disabled');
        await vi.runAllTimersAsync();
        await first;
        expect(AniListHealth.isDown()).toBe(true);

        const blocked = client.request('query', {}).catch((error) => error);
        await vi.runAllTimersAsync();
        expect(isAniListDown(await blocked)).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(1);

        // 5 minutes later: one probe goes out, the next request is still refused.
        vi.setSystemTime(1_000_000 + 5 * 60 * 1000);
        fetchFn.mockImplementation(() => Promise.resolve(json({ data: { ok: true } })));
        const probe = client.request<{ ok: boolean }>('query', {});
        const refused = client.request('query', {}).catch((error) => error);
        await vi.runAllTimersAsync();
        await expect(probe).resolves.toEqual({ ok: true });
        expect(isAniListDown(await refused)).toBe(true);
        expect(fetchFn).toHaveBeenCalledTimes(2);
        // The probe answered: AniList is back.
        expect(AniListHealth.isDown()).toBe(false);
    });

    it('a network error or a 5xx marks AniList down; a bad query does not', async () => {
        const notFound = clientAnswering(() =>
            Promise.resolve(json({ data: null, errors: [{ message: 'Not Found.' }] }, 404)),
        )
            .request('query', {})
            .catch(() => {});
        await vi.runAllTimersAsync();
        await notFound;
        expect(AniListHealth.isDown()).toBe(false);

        const network = clientAnswering(() => Promise.reject(new TypeError('Failed to fetch')))
            .request('query', {})
            .catch(() => {});
        await vi.runAllTimersAsync();
        await network;
        expect(AniListHealth.getState().lastError).toBe('Failed to fetch');

        AniListHealth.reset();
        const bad = clientAnswering(() => Promise.resolve(json({}, 502)))
            .request('query', {})
            .catch(() => {});
        await vi.runAllTimersAsync();
        await bad;
        expect(AniListHealth.isDown()).toBe(true);
    });
});
