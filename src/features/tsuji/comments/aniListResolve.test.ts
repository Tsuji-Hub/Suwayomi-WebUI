/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it, vi } from 'vitest';
import type { CommentsCache, RelayClient } from '@/features/tsuji/comments/comickSource.ts';
import {
    AL_MISS_TTL_MS,
    getAniListLink,
    getMangaDexTitles,
    resolveComickByAniList,
} from '@/features/tsuji/comments/aniListResolve.ts';

const memoryCache = () => {
    const store = new Map<string, { value: unknown; ttl: number }>();
    const cache: CommentsCache = {
        get: <T>(key: string) => (store.get(key)?.value as T) ?? null,
        set: (key, value, ttl) => {
            store.set(key, { value, ttl });
        },
    };
    return { cache, store };
};

const fakeClient = (routes: Record<string, unknown>) => {
    const get = vi.fn(async (path: string) => {
        const key = Object.keys(routes).find((route) => path.startsWith(route));
        return key ? routes[key] : null;
    });
    return { client: { get } as unknown as RelayClient, get };
};

const { signal } = new AbortController();

describe('AniList links', () => {
    it('reads links.al as a number', () => {
        expect(getAniListLink({ al: '105398' })).toBe(105398);
        expect(getAniListLink({ al: 105398 })).toBe(105398);
        expect(getAniListLink({ mu: 'x' })).toBeNull();
        expect(getAniListLink(null)).toBeNull();
    });

    it('takes MangaDex titles only from the manga linked to the id', () => {
        const json = {
            data: [
                { attributes: { title: { en: 'Wrong One' }, links: { al: '1' } } },
                {
                    attributes: {
                        title: { en: 'Return of the Disaster-Class Hero' },
                        altTitles: [{ 'ko-ro': 'Jaenaggeup Yeongungnim-ui Gwihwan' }, { ko: '재앙급 영웅님의 귀환' }],
                        links: { al: '2' },
                    },
                },
            ],
        };
        expect(getMangaDexTitles(json, 2)).toEqual([
            'Return of the Disaster-Class Hero',
            'Jaenaggeup Yeongungnim-ui Gwihwan',
        ]);
        expect(getMangaDexTitles(json, 3)).toEqual([]);
    });
});

describe('resolving Comick by AniList id', () => {
    it('keeps only the comic whose links.al is the id (detail fetched when search has no links)', async () => {
        const { client: comick, get } = fakeClient({
            '/v1.0/search': [
                { id: 1, hid: 'same-name', slug: 'same-name', title: 'Player' },
                { id: 2, hid: 'rtp', slug: 'return-to-player', title: 'Return to Player' },
            ],
            '/comic/return-to-player/': { comic: { links: { al: '137715' } } },
            '/comic/same-name/': { comic: { links: { al: '999' } } },
        });
        const { client: mangadex } = fakeClient({});
        const { cache, store } = memoryCache();
        expect(
            await resolveComickByAniList(
                { anilistId: 137715, titles: ['Return to Player'] },
                { comick, mangadex, cache },
                signal,
            ),
        ).toBe('rtp|2');
        expect(get.mock.calls.map(([path]) => path)).toEqual([
            '/v1.0/search?q=Return%20to%20Player&limit=10&t=false',
            '/comic/return-to-player/',
        ]);
        expect(store.get('comments:al:v1:137715')?.value).toEqual({ seriesKey: 'rtp|2' });
    });

    it('a title-only look-alike is never accepted: no verified match = null, cached for a day', async () => {
        const { client: comick } = fakeClient({
            '/v1.0/search': [{ id: 1, hid: 'x', slug: 'x', title: 'Return to Player', links: { al: '1' } }],
        });
        const { client: mangadex } = fakeClient({ '/manga': { data: [] } });
        const { cache, store } = memoryCache();
        expect(
            await resolveComickByAniList(
                { anilistId: 137715, titles: ['Return to Player'] },
                { comick, mangadex, cache },
                signal,
            ),
        ).toBeNull();
        expect(store.get('comments:al:v1:137715')).toEqual({ value: { seriesKey: null }, ttl: AL_MISS_TTL_MS });
    });

    it('falls back to MangaDex titles of the linked manga', async () => {
        const comickGet = vi.fn(async (path: string) =>
            path.includes('Disaster-Class')
                ? [{ id: 5, hid: 'dch', slug: 'dch', title: 'Return of the Disaster-Class Hero', links: { al: '42' } }]
                : [],
        );
        const { client: mangadex } = fakeClient({
            '/manga': {
                data: [{ attributes: { title: { en: 'Return of the Disaster-Class Hero' }, links: { al: '42' } } }],
            },
        });
        const { cache } = memoryCache();
        expect(
            await resolveComickByAniList(
                { anilistId: 42, titles: ['Jaenaggeup'] },
                { comick: { get: comickGet } as unknown as RelayClient, mangadex, cache },
                signal,
            ),
        ).toBe('dch|5');
    });

    it('answers from the cache without requests', async () => {
        const { client: comick, get } = fakeClient({});
        const { client: mangadex } = fakeClient({});
        const { cache } = memoryCache();
        cache.set('comments:al:v1:7', { seriesKey: 'a|1' }, 1);
        expect(await resolveComickByAniList({ anilistId: 7, titles: ['A'] }, { comick, mangadex, cache }, signal)).toBe(
            'a|1',
        );
        expect(get).not.toHaveBeenCalled();
    });
});
