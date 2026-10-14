/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it, vi } from 'vitest';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import { CommentsRelayError } from '@/features/tsuji/comments/CommentSource.ts';
import {
    findChapterKey,
    formatSeriesKey,
    mapComickComment,
    MATCH_THRESHOLD,
    parseSeriesKey,
    pickBestMatch,
    reduceChapterMap,
    titleSimilarity,
} from '@/features/tsuji/comments/comick.ts';
import type { CommentsCache } from '@/features/tsuji/comments/comickSource.ts';
import { createComickSource, createRelayClient } from '@/features/tsuji/comments/comickSource.ts';
import { parseCommentBody, tokenizeLine } from '@/features/tsuji/comments/commentText.ts';
import {
    applyMatchPatch,
    CommentMatchesFullError,
    createMatchUpdater,
    MATCHES_MAX_CHARS,
    parseCommentMatches,
} from '@/features/tsuji/comments/commentsMatch.ts';

const freeQueue = () => new SpacedQueue(0, { burst: 100 });

const jsonResponse = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const memoryCache = (): CommentsCache & { store: Map<string, unknown> } => {
    const store = new Map<string, unknown>();
    return {
        store,
        get: <T>(key: string) => (store.has(key) ? (store.get(key) as T) : null),
        set: (key, value) => {
            store.set(key, value);
        },
    };
};

describe('reduceChapterMap', () => {
    it('keeps the most up-voted scanlation per chapter, string keys as sent', () => {
        expect(
            reduceChapterMap([
                { hid: 'a1', chap: '1', up_count: 3 },
                { hid: 'a2', chap: '1', up_count: 9 },
                { hid: 'a3', chap: '1', up_count: 9 },
                { hid: 'b1', chap: '200.5', up_count: 1 },
                { hid: 'c1', chap: '2', up_count: null },
                { hid: 'x', chap: null, up_count: 50 },
                { hid: 'y', chap: '  ', up_count: 50 },
            ]),
        ).toEqual({ '1': 'a2', '200.5': 'b1', '2': 'c1' });
    });
});

describe('findChapterKey', () => {
    const map = { '1': 'a', '012': 'b', '200.5': 'c', '7.0': 'd' };

    it('prefers the exact string, then numeric equality', () => {
        expect(findChapterKey(map, 1)).toBe('1');
        expect(findChapterKey(map, 12)).toBe('012');
        expect(findChapterKey(map, 200.5)).toBe('200.5');
        expect(findChapterKey(map, 7)).toBe('7.0');
    });

    it('returns null for missing or unknown (-1) chapter numbers', () => {
        expect(findChapterKey(map, 3)).toBeNull();
        expect(findChapterKey(map, -1)).toBeNull();
        expect(findChapterKey(map, Number.NaN)).toBeNull();
    });
});

describe('series keys', () => {
    it('round-trips "hid|id" and rejects anything else', () => {
        expect(parseSeriesKey(formatSeriesKey('abC_-9', 42))).toEqual({ hid: 'abC_-9', id: 42 });
        expect(parseSeriesKey('abc|')).toBeNull();
        expect(parseSeriesKey('abc|1|2')).toBeNull();
        expect(parseSeriesKey('a b|1')).toBeNull();
        expect(parseSeriesKey('abc|-1')).toBeNull();
        expect(parseSeriesKey(null)).toBeNull();
    });
});

describe('title matching', () => {
    it('scores the same title 1 and unrelated titles low', () => {
        expect(titleSimilarity('Solo Leveling', 'solo leveling!')).toBe(1);
        expect(titleSimilarity('Solo Leveling', 'Omniscient Reader')).toBeLessThan(MATCH_THRESHOLD);
    });

    it('matches via alternative titles and refuses below the threshold', () => {
        const results = [
            { id: 1, hid: 'aaa', title: 'Something Else' },
            { id: 2, hid: 'bbb', title: 'Na Honjaman Level Up', md_titles: [{ title: 'Solo Leveling' }] },
        ];
        expect(pickBestMatch(['Solo Leveling'], results)?.seriesKey).toBe('bbb|2');
        expect(pickBestMatch(['A Completely Different Story'], results)).toBeNull();
    });
});

describe('comment text', () => {
    it('turns ||spoilers|| into spoiler segments and links into their label', () => {
        expect(tokenizeLine('He ||dies|| in [chapter 5](https://x.y/5) **really**')).toEqual([
            { type: 'text', text: 'He ' },
            { type: 'spoiler', text: 'dies' },
            { type: 'text', text: ' in chapter 5 really' },
        ]);
    });

    it('leaves an unclosed spoiler marker as typed and drops image markup to its alt text', () => {
        expect(tokenizeLine('a || b ![pic](http://i/x.png)')).toEqual([{ type: 'text', text: 'a || b pic' }]);
    });

    it('groups > lines into quote blocks and splits paragraphs on blank lines', () => {
        expect(parseCommentBody('> quoted\n>more\nreply\n\nsecond')).toEqual([
            { type: 'quote', lines: [[{ type: 'text', text: 'quoted' }], [{ type: 'text', text: 'more' }]] },
            { type: 'paragraph', lines: [[{ type: 'text', text: 'reply' }]] },
            { type: 'paragraph', lines: [[{ type: 'text', text: 'second' }]] },
        ]);
    });

    it('keeps HTML as literal text (rendered as text, never markup)', () => {
        expect(parseCommentBody('<img src=x onerror=alert(1)>')).toEqual([
            { type: 'paragraph', lines: [[{ type: 'text', text: '<img src=x onerror=alert(1)>' }]] },
        ]);
    });
});

describe('mapComickComment', () => {
    it('maps author, replies and defaults', () => {
        expect(
            mapComickComment({
                id: 5,
                content: 'hi',
                up_count: 2,
                created_at: '2026-10-01T00:00:00Z',
                identities: { traits: { username: 'reader' } },
                other_comments: [{ id: 6, content: 'yo' }],
            }),
        ).toEqual({
            id: '5',
            author: 'reader',
            createdAt: '2026-10-01T00:00:00Z',
            body: 'hi',
            upCount: 2,
            replies: [{ id: '6', author: 'Anonymous', createdAt: null, body: 'yo', upCount: 0, replies: [] }],
        });
    });
});

describe('manual matches (tsuji_commentsMatch)', () => {
    it('parses tolerantly', () => {
        expect(parseCommentMatches('{"12":"abc|3","x":"abc|3","13":"bad","14":5}')).toEqual({ '12': 'abc|3' });
        expect(parseCommentMatches('not json')).toEqual({});
        expect(parseCommentMatches('[1]')).toEqual({});
        expect(parseCommentMatches(undefined)).toEqual({});
    });

    it('merges on write against the server value, and null clears', async () => {
        let server = JSON.stringify({ '1': 'aaa|1', '2': 'bbb|2' });
        const update = createMatchUpdater({
            read: async () => parseCommentMatches(server),
            write: async (value) => {
                server = value;
            },
        });

        // Another device wrote manga 3 meanwhile: kept.
        server = JSON.stringify({ ...JSON.parse(server), '3': 'ccc|3' });
        await Promise.all([update({ '4': 'ddd|4' }), update({ '1': null })]);

        expect(JSON.parse(server)).toEqual({ '2': 'bbb|2', '3': 'ccc|3', '4': 'ddd|4' });
        expect(applyMatchPatch({ '1': 'a|1' }, { '1': 'b|2' })).toEqual({ '1': 'b|2' });
    });

    it('refuses a write over the size guard and leaves the server value alone', async () => {
        const big = Object.fromEntries(
            Array.from({ length: 200 }, (_, index) => [String(index + 1), `hid${index}xxxxx|${index}`]),
        );
        expect(JSON.stringify(big).length).toBeGreaterThan(MATCHES_MAX_CHARS);
        const write = vi.fn(async () => {});
        const update = createMatchUpdater({ read: async () => ({}), write });

        await expect(update(big)).rejects.toBeInstanceOf(CommentMatchesFullError);
        expect(write).not.toHaveBeenCalled();
    });
});

describe('relay client', () => {
    it('times out after timeoutMs with a relay error (one request, no retry)', async () => {
        const fetchFn = vi.fn(
            (_input: string, init?: RequestInit) =>
                new Promise<Response>((_, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
                }),
        );
        const client = createRelayClient({
            getBaseUrl: () => 'http://relay',
            fetchFn,
            queue: freeQueue(),
            timeoutMs: 20,
        });

        await expect(client.get('/x', new AbortController().signal)).rejects.toBeInstanceOf(CommentsRelayError);
        expect(fetchFn).toHaveBeenCalledTimes(1);
        expect(fetchFn.mock.calls[0][0]).toBe('http://relay/comick/x');
    });

    it('maps network failures and 5xx to relay errors, 404 to null', async () => {
        const down = createRelayClient({
            getBaseUrl: () => 'http://relay/',
            fetchFn: async () => {
                throw new TypeError('Failed to fetch');
            },
            queue: freeQueue(),
        });
        await expect(down.get('/x', new AbortController().signal)).rejects.toBeInstanceOf(CommentsRelayError);

        const status = (code: number) =>
            createRelayClient({
                getBaseUrl: () => 'http://relay',
                fetchFn: async () => jsonResponse({}, code),
                queue: freeQueue(),
            });
        await expect(status(502).get('/x', new AbortController().signal)).rejects.toBeInstanceOf(CommentsRelayError);
        await expect(status(404).get('/x', new AbortController().signal)).resolves.toBeNull();
    });

    it('passes a caller abort through as the abort, not as a relay error', async () => {
        const controller = new AbortController();
        const client = createRelayClient({
            getBaseUrl: () => 'http://relay',
            fetchFn: (_input, init) =>
                new Promise<Response>((_, reject) => {
                    init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
                }),
            queue: freeQueue(),
        });
        const request = client.get('/x', controller.signal);
        controller.abort(new DOMException('gone', 'AbortError'));
        await expect(request).rejects.not.toBeInstanceOf(CommentsRelayError);
    });
});

describe('Comick source', () => {
    const routes = (paths: Record<string, unknown>) =>
        vi.fn(async (input: string) => {
            const url = new URL(input);
            const key = url.pathname.replace(/^\/comick/, '');
            return key in paths ? jsonResponse(paths[key]) : jsonResponse({}, 404);
        });

    it('resolves the series, the chapter thread and its comments, caching match and chapter map', async () => {
        const fetchFn = routes({
            '/v1.0/search': [{ id: 7, hid: 'solo', title: 'Solo Leveling' }],
            '/comic/solo/chapters': {
                chapters: [
                    { hid: 'c1a', chap: '1', up_count: 1 },
                    { hid: 'c1b', chap: '1', up_count: 5 },
                ],
            },
            '/comment/chapter/c1b': { comments: [{ id: 1, content: 'first' }] },
        });
        const cache = memoryCache();
        const source = createComickSource({
            client: createRelayClient({ getBaseUrl: () => 'http://relay', fetchFn, queue: freeQueue() }),
            cache,
        });
        const { signal } = new AbortController();

        const match = await source.resolveSeries(['Solo Leveling'], signal);
        expect(match).toEqual({ seriesKey: 'solo|7', title: 'Solo Leveling' });
        const thread = await source.thread('solo|7', 1, signal);
        expect(thread).toEqual({ seriesKey: 'solo|7', chapterKey: '1', threadKey: 'c1b' });
        const page = await source.comments(thread!, null, signal);
        expect(page.comments.map(({ body }) => body)).toEqual(['first']);
        expect(fetchFn.mock.calls.at(-1)?.[0]).toBe(
            'http://relay/comick/comment/chapter/c1b?lang=en&comic-id=7&chap=1',
        );

        await source.resolveSeries(['Solo Leveling'], signal);
        expect(await source.thread('solo|7', 2, signal)).toBeNull();
        // search, chapters, comments: the second resolve and thread lookup came from the cache.
        expect(fetchFn).toHaveBeenCalledTimes(3);
    });

    it('caches a miss so an unmatched series is not searched again', async () => {
        const fetchFn = routes({ '/v1.0/search': [{ id: 1, hid: 'x', title: 'Unrelated Title Here' }] });
        const source = createComickSource({
            client: createRelayClient({ getBaseUrl: () => 'http://relay', fetchFn, queue: freeQueue() }),
            cache: memoryCache(),
        });
        const { signal } = new AbortController();

        expect(await source.resolveSeries(['My Series'], signal)).toBeNull();
        expect(await source.resolveSeries(['My Series'], signal)).toBeNull();
        expect(fetchFn).toHaveBeenCalledTimes(1);
    });
});
