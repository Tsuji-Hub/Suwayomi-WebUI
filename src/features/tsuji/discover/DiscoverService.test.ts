/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

const request = vi.fn();

vi.mock('@/features/tsuji/services/AniListClient.ts', () => ({ aniList: { request } }));
vi.mock('@/features/tsuji/services/TsujiCache.ts', () => ({
    TsujiCache: { get: () => null, set: () => {}, remove: () => {} },
}));

const { loadDiscoverPage } = await import('@/features/tsuji/discover/DiscoverService.ts');

const page = (ids: number[], hasNextPage = true) => ({
    Page: { pageInfo: { hasNextPage }, media: ids.map((id) => ({ id })) },
});

type RequestVariables = { sort: string[]; formatNotIn?: string[]; tagIn?: string[] };
const calls = () => request.mock.calls.map((call) => call[1] as RequestVariables);

describe('loadDiscoverPage fallbacks (degraded AniList)', () => {
    beforeEach(() => request.mockReset());

    it('returns page 1 as-is when it has results', async () => {
        request.mockResolvedValueOnce(page([1, 2]));

        const result = await loadDiscoverPage({
            variables: { tagIn: ['A'], formatNotIn: ['NOVEL'] },
            serverSort: 'POPULARITY_DESC',
            page: 1,
            signal: new AbortController().signal,
        });

        expect(result).toMatchObject({ serverSort: 'POPULARITY_DESC', isRelaxed: false });
        expect(request).toHaveBeenCalledTimes(1);
    });

    it('retries without optional filters when page 1 is empty', async () => {
        request.mockResolvedValueOnce(page([], false)).mockResolvedValueOnce(page([3]));

        const result = await loadDiscoverPage({
            variables: { tagIn: ['B'], formatNotIn: ['NOVEL'], isAdult: false },
            serverSort: 'POPULARITY_DESC',
            page: 1,
            signal: new AbortController().signal,
        });

        expect(result).toMatchObject({ serverSort: 'POPULARITY_DESC', isRelaxed: true, media: [{ id: 3 }] });
        expect(calls()[1]).toEqual({ tagIn: ['B'], page: 1, perPage: 30, sort: ['POPULARITY_DESC'] });
    });

    it('falls back to another sort and remembers it for the session', async () => {
        request
            .mockResolvedValueOnce(page([], false))
            .mockResolvedValueOnce(page([], false))
            .mockResolvedValueOnce(page([4]));

        const first = await loadDiscoverPage({
            variables: { formatNotIn: ['NOVEL'] },
            serverSort: 'TRENDING_DESC',
            page: 1,
            signal: new AbortController().signal,
        });
        expect(first).toMatchObject({ serverSort: 'POPULARITY_DESC', isRelaxed: true });

        request.mockResolvedValueOnce(page([5]));
        const again = await loadDiscoverPage({
            variables: { tagIn: ['C'] },
            serverSort: 'TRENDING_DESC',
            page: 1,
            signal: new AbortController().signal,
        });

        expect(again.serverSort).toBe('POPULARITY_DESC');
        expect(calls()[3].sort).toEqual(['POPULARITY_DESC']);
    });

    it('keeps later pages on the relaxed variables page 1 settled on', async () => {
        request.mockResolvedValueOnce(page([6]));

        await loadDiscoverPage({
            variables: { tagIn: ['D'], formatNotIn: ['NOVEL'] },
            serverSort: 'SCORE_DESC',
            page: 2,
            isRelaxed: true,
            signal: new AbortController().signal,
        });

        expect(calls()[0]).toEqual({ tagIn: ['D'], page: 2, perPage: 30, sort: ['SCORE_DESC'] });
    });

    it('reports an empty page when nothing works, without retrying later pages', async () => {
        request.mockResolvedValue(page([], false));

        const result = await loadDiscoverPage({
            variables: { tagIn: ['E'] },
            serverSort: 'SCORE_DESC',
            page: 1,
            signal: new AbortController().signal,
        });

        expect(result.media).toEqual([]);
        expect(request).toHaveBeenCalledTimes(1);
    });
});
