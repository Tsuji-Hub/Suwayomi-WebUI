/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();
const sessionStore = new Map<string, string>();

vi.mock('@/features/tsuji/services/AniListClient.ts', async () => {
    class AniListError extends Error {
        constructor(
            message: string,
            readonly status: number,
        ) {
            super(message);
        }
    }
    return {
        aniList: { request },
        AniListError,
        ANILIST_TIMEOUT_MS: { fast: 4000, slow: 12_000 },
        isAniListTimeout: (error: unknown) => error instanceof AniListError && error.status === 408,
    };
});
vi.mock('@/features/tsuji/services/TsujiCache.ts', () => ({
    TsujiCache: { get: () => null, set: () => {}, remove: () => {} },
}));
vi.mock('@/lib/storage/AppStorage.ts', () => ({
    AppStorage: {
        session: {
            getItemParsed: (key: string, fallback: unknown) =>
                sessionStore.has(key) ? JSON.parse(sessionStore.get(key)!) : fallback,
            setItem: (key: string, value: unknown) => sessionStore.set(key, JSON.stringify(value)),
        },
    },
}));

const { AniListError } = await import('@/features/tsuji/services/AniListClient.ts');
const { loadDiscoverPage } = await import('@/features/tsuji/discover/DiscoverService.ts');
const { DegradedMemory } = await import('@/features/tsuji/discover/degradedMemory.ts');

const page = (ids: number[], hasNextPage = true) => ({
    Page: { pageInfo: { hasNextPage }, media: ids.map((id) => ({ id })) },
});
const timeout = () => Promise.reject(new AniListError('timed out', 408));

type RequestVariables = { sort: string[]; statusIn?: string[]; tagIn?: string[] };
type RequestOptions = { timeoutMs: number };
const calls = () => request.mock.calls.map((call) => call[1] as RequestVariables);
const timeouts = () => request.mock.calls.map((call) => (call[2] as RequestOptions).timeoutMs);

const load = (options: Partial<Parameters<typeof loadDiscoverPage>[0]>) =>
    loadDiscoverPage({
        variables: {},
        serverSort: 'POPULARITY_DESC',
        page: 1,
        signal: new AbortController().signal,
        ...options,
    });

describe('loadDiscoverPage (degraded AniList)', () => {
    beforeEach(() => {
        request.mockReset();
        sessionStore.clear();
        DegradedMemory.reset();
    });

    it('returns page 1 as-is, with the slow budget when no retry follows', async () => {
        request.mockResolvedValueOnce(page([1, 2]));

        const result = await load({ variables: { tagIn: ['A'] } });

        expect(result).toMatchObject({ serverSort: 'POPULARITY_DESC', isRelaxed: false });
        expect(timeouts()).toEqual([12_000]);
    });

    it('retries without optional filters when page 1 is empty and remembers it', async () => {
        request.mockResolvedValueOnce(page([], false)).mockResolvedValueOnce({
            Page: { pageInfo: { hasNextPage: true }, media: [{ id: 3, status: 'FINISHED' }] },
        });

        const result = await load({ variables: { tagIn: ['B'], statusIn: ['FINISHED'] } });

        expect(result).toMatchObject({ isRelaxed: true, media: [{ id: 3 }] });
        expect(calls()[1]).toEqual({ tagIn: ['B'], page: 1, perPage: 50, sort: ['POPULARITY_DESC'] });
        expect(timeouts()).toEqual([4000, 12_000]);
        expect(DegradedMemory.shouldRelaxFilters()).toBe(true);
    });

    it('falls back after a 4 s timeout and goes straight to the fallback next time', async () => {
        request.mockImplementationOnce(timeout).mockResolvedValueOnce(page([4]));

        const first = await load({ serverSort: 'TRENDING_DESC', variables: { tagIn: ['C'] } });
        expect(first).toMatchObject({ serverSort: 'POPULARITY_DESC', media: [{ id: 4 }] });
        expect(timeouts()).toEqual([4000, 12_000]);
        expect(DegradedMemory.isSortFailed('TRENDING_DESC')).toBe(true);

        // Straight to the fallback: no Trending attempt, and the fallback page comes from the session memo.
        const again = await load({ serverSort: 'TRENDING_DESC', variables: { tagIn: ['C'] } });

        expect(again).toMatchObject({ serverSort: 'POPULARITY_DESC', media: [{ id: 4 }] });
        expect(request).toHaveBeenCalledTimes(2);
    });

    it('treats relaxed results that fail the dropped filters as a genuine "no matches"', async () => {
        request.mockResolvedValueOnce(page([], false)).mockResolvedValueOnce({
            Page: { pageInfo: { hasNextPage: true }, media: [{ id: 7, status: 'RELEASING' }] },
        });

        const result = await load({ variables: { tagIn: ['Narrow'], statusIn: ['HIATUS'] } });

        expect(result.media).toEqual([]);
        expect(DegradedMemory.shouldRelaxFilters()).toBe(false);
    });

    it('remembers nothing when the fallback sort fails too', async () => {
        request.mockImplementation(timeout);

        await expect(load({ serverSort: 'START_DATE_DESC', variables: { tagIn: ['Down'] } })).rejects.toThrow(
            'timed out',
        );
        expect(DegradedMemory.isSortFailed('START_DATE_DESC')).toBe(false);
    });

    it('does not blame the sort for a genuinely empty result', async () => {
        request.mockResolvedValueOnce(page([], false)).mockResolvedValueOnce(page([], false));

        const result = await load({ serverSort: 'START_DATE_DESC', variables: { tagIn: ['Nothing'] } });

        expect(result.media).toEqual([]);
        expect(DegradedMemory.isSortFailed('START_DATE_DESC')).toBe(false);
    });

    it('skips the sort fallback when asked (landing loads Popular itself)', async () => {
        request.mockImplementationOnce(timeout);

        await expect(
            load({ serverSort: 'TRENDING_DESC', allowSortFallback: false, variables: { tagIn: ['L'] } }),
        ).rejects.toThrow('timed out');
        expect(timeouts()).toEqual([12_000]);
    });

    it('keeps later pages on the sort and relaxation page 1 settled on', async () => {
        request.mockResolvedValueOnce(page([6]));

        await load({
            variables: { tagIn: ['D'], statusIn: ['FINISHED'] },
            serverSort: 'SCORE_DESC',
            page: 2,
            isRelaxed: true,
        });

        expect(calls()[0]).toEqual({ tagIn: ['D'], page: 2, perPage: 50, sort: ['SCORE_DESC'] });
    });

    it('throws when the last attempt times out', async () => {
        request.mockImplementation(timeout);

        await expect(load({ serverSort: 'TRENDING_DESC', variables: { tagIn: ['Z'] } })).rejects.toThrow('timed out');
        expect(request).toHaveBeenCalledTimes(2);
    });
});

describe('DegradedMemory', () => {
    beforeEach(() => {
        sessionStore.clear();
        DegradedMemory.reset();
    });

    it('expires after 30 minutes', () => {
        DegradedMemory.rememberSortFailed('TRENDING_DESC', 0);

        expect(DegradedMemory.isSortFailed('TRENDING_DESC', 29 * 60 * 1000)).toBe(true);
        expect(DegradedMemory.isSortFailed('TRENDING_DESC', 30 * 60 * 1000 + 1)).toBe(false);
    });

    it('survives a reload through sessionStorage', () => {
        DegradedMemory.rememberRelaxFilters(0);
        DegradedMemory.reset();

        expect(DegradedMemory.shouldRelaxFilters(1000)).toBe(true);
    });
});
