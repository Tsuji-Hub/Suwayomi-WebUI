/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { SeenMarks } from '@/features/tsuji/seen/seen.ts';
import { createUndoPatch } from '@/features/tsuji/seen/seen.ts';
import type { SeenWritePlan } from '@/features/tsuji/seen/seenShards.ts';
import {
    createSeenUpdater,
    getSeenBucket,
    getSeenShardKey,
    parseSeenBucket,
    planSeenWrite,
    readSeenStore,
    SEEN_BUCKET_MAX_CHARS,
    SEEN_SHARD_COUNT,
    SeenBucketFullError,
    serializeSeenBucket,
} from '@/features/tsuji/seen/seenShards.ts';

/** Suwayomi's global meta limit that `tsuji_seen` ran into (a 9247-char write was rejected). */
const SERVER_VALUE_LIMIT = 4096;

/** In-memory global meta with the server's value limit; records every write request. */
const createServer = (initial: Record<string, string> = {}) => {
    const server = { meta: { ...initial } as Record<string, string>, writes: [] as SeenWritePlan[], failNext: false };
    const update = createSeenUpdater({
        read: () => Promise.resolve(readSeenStore({ ...server.meta })),
        write: (plan) => {
            if (server.failNext) {
                server.failNext = false;
                return Promise.reject(new Error('offline'));
            }
            const tooLong = plan.set.find(([, value]) => value.length > SERVER_VALUE_LIMIT);
            if (tooLong) {
                return Promise.reject(new Error(`value of ${tooLong[0]} is ${tooLong[1].length} chars`));
            }
            server.writes.push(plan);
            plan.set.forEach(([key, value]) => {
                server.meta[key] = value;
            });
            plan.delete.forEach((key) => {
                delete server.meta[key];
            });
            return Promise.resolve();
        },
    });
    const marks = () => readSeenStore(server.meta).marks;

    return { server, update, marks };
};

/** `count` distinct AniList-like ids (6 digits, like most current manga ids). */
const manyMarks = (count: number, firstId = 100_000): SeenMarks =>
    Object.fromEntries(
        Array.from({ length: count }, (_, index) => [String(firstId + index * 7), index % 3 ? 'read' : 'skip']),
    );

describe('shard format', () => {
    it('buckets by mediaId % 16 into tsuji_seen_0..15', () => {
        expect(SEEN_SHARD_COUNT).toBe(16);
        expect(getSeenBucket(105398)).toBe(105398 % 16);
        expect(getSeenShardKey(0)).toBe('tsuji_seen_0');
        expect(getSeenShardKey(15)).toBe('tsuji_seen_15');
    });

    it('serializes a bucket as {"r":[ids],"s":[ids]} ascending, null when empty', () => {
        const marks: SeenMarks = { 32: 'read', 16: 'skip', 48: 'read', 1: 'read' };
        expect(serializeSeenBucket(marks, 0)).toBe('{"r":[32,48],"s":[16]}');
        expect(serializeSeenBucket(marks, 1)).toBe('{"r":[1],"s":[]}');
        expect(serializeSeenBucket(marks, 2)).toBeNull();
    });

    it('parses a bucket tolerantly', () => {
        expect(parseSeenBucket('{"r":[32,"x",-1,0,1.5],"s":[16],"q":[7]}')).toEqual({ 32: 'read', 16: 'skip' });
        expect(parseSeenBucket('{oops')).toEqual({});
        expect(parseSeenBucket('[1]')).toEqual({});
        expect(parseSeenBucket(undefined)).toEqual({});
    });
});

describe('sharded tsuji_seen round-trip', () => {
    it('stores 5,000 marks under the server limit and reads them all back', async () => {
        const { server, update, marks } = createServer();
        const written = manyMarks(5000);

        await update(written);

        expect(marks()).toEqual(written);
        expect(Object.keys(marks())).toHaveLength(5000);
        const keys = Object.keys(server.meta);
        expect(keys.sort()).toEqual(Array.from({ length: 16 }, (_, bucket) => `tsuji_seen_${bucket}`).sort());
        Object.values(server.meta).forEach((value) => expect(value.length).toBeLessThanOrEqual(SEEN_BUCKET_MAX_CHARS));
        expect(server.writes).toHaveLength(1);
    });

    it('writes only the touched bucket for a single mark', async () => {
        const { server, update, marks } = createServer();
        await update(manyMarks(5000));
        const before = { ...server.meta };

        await update({ 105398: 'read' });

        const plan = server.writes.at(-1)!;
        expect(plan.set.map(([key]) => key)).toEqual([getSeenShardKey(getSeenBucket(105398))]);
        expect(plan.delete).toEqual([]);
        expect(marks()[105398]).toBe('read');
        Object.keys(before)
            .filter((key) => key !== getSeenShardKey(getSeenBucket(105398)))
            .forEach((key) => expect(server.meta[key]).toBe(before[key]));
    });

    it('deletes a bucket key once its last mark is removed, and skips no-op writes', async () => {
        const { server, update, marks } = createServer();
        await update({ 17: 'read' });
        await update({ 17: 'read' });
        expect(server.writes).toHaveLength(1);

        await update({ 17: null });
        expect(server.writes.at(-1)).toEqual({ set: [], delete: ['tsuji_seen_1'] });
        expect(server.meta).toEqual({});
        expect(marks()).toEqual({});
    });

    it('clears all 5,000 marks', async () => {
        const { server, update } = createServer();
        await update(manyMarks(5000));
        await update((current) => Object.fromEntries(Object.keys(current).map((key) => [key, null])));
        expect(server.meta).toEqual({});
    });
});

describe('merge-on-write', () => {
    it("keeps another device's mark in the same bucket written between our reads", async () => {
        const { server, update, marks } = createServer();
        await update({ 1: 'read' });
        // The downstairs PC marks 17 (same bucket as 1) on its own.
        server.meta.tsuji_seen_1 = serializeSeenBucket({ 1: 'read', 17: 'skip' }, 1)!;
        await update({ 33: 'read' });

        expect(marks()).toEqual({ 1: 'read', 17: 'skip', 33: 'read' });
    });

    it('serializes quick successive updates from the same tab', async () => {
        const { update, marks } = createServer();
        await Promise.all([update({ 1: 'read' }), update({ 2: 'skip' }), update({ 1: null })]);
        expect(marks()).toEqual({ 2: 'skip' });
    });

    it('undo restores the previous value only while the title still has the undone mark', async () => {
        const { update, marks } = createServer({ tsuji_seen_5: '{"r":[],"s":[5]}' });

        let previous: SeenMarks[string] | null = null;
        await update((current) => {
            previous = current[5] ?? null;
            return { 5: 'read' };
        });
        await update(createUndoPatch('5', 'read', previous));
        expect(marks()).toEqual({ 5: 'skip' });

        await update({ 5: 'read' });
        await update({ 5: null }); // a newer action (Unhide) happened before the old toast's Undo
        await update(createUndoPatch('5', 'read', 'skip'));
        expect(marks()).toEqual({});
    });

    it('keeps working after a failed write', async () => {
        const { server, update, marks } = createServer();
        server.failNext = true;
        await expect(update({ 3: 'read' })).rejects.toThrow('offline');
        await update({ 4: 'read' });
        expect(marks()).toEqual({ 4: 'read' });
    });
});

describe('legacy tsuji_seen migration', () => {
    it('reads the legacy value until migrated', () => {
        const store = readSeenStore({ tsuji_seen: '{"7":"read","8":"skip"}', tsuji_seen_7: '{"r":[],"s":[7]}' });
        // The shard is newer than the legacy value.
        expect(store.marks).toEqual({ 7: 'skip', 8: 'skip' });
        expect(store.legacyKeys).toEqual(['tsuji_seen']);
    });

    it('moves 350 legacy marks (a value over the server limit) into the shards on the next write and deletes the key', async () => {
        const legacy = Object.fromEntries(
            Array.from({ length: 350 }, (_, index) => [String(150_000 + index * 13), index % 4 ? 'read' : 'skip']),
        );
        const legacyValue = JSON.stringify(legacy);
        expect(legacyValue.length).toBeGreaterThan(SERVER_VALUE_LIMIT);
        const { server, update, marks } = createServer({ tsuji_seen: legacyValue, tsuji_recFilters: '{}' });

        await update({});

        expect(server.meta.tsuji_seen).toBeUndefined();
        expect(server.meta.tsuji_recFilters).toBe('{}');
        expect(marks()).toEqual(legacy);
        expect(server.writes).toHaveLength(1);
        expect(server.writes[0].delete).toEqual(['tsuji_seen']);

        // Afterwards only touched buckets are written again.
        await update({ 1: 'read' });
        expect(server.writes.at(-1)!.set.map(([key]) => key)).toEqual(['tsuji_seen_1']);
    });

    it("migrates upstream's chunked legacy layout without mistaking the chunks for shards", async () => {
        const legacy = manyMarks(800, 200_000);
        const value = JSON.stringify(legacy);
        const chunks = [value.slice(0, 4000), value.slice(4000, 8000), value.slice(8000)].filter(Boolean);
        const initial: Record<string, string> = { tsuji_seen_length: String(chunks.length) };
        chunks.forEach((chunk, index) => {
            initial[`tsuji_seen_${index}`] = chunk;
        });
        const { server, update, marks } = createServer(initial);

        expect(readSeenStore(initial).marks).toEqual(legacy);
        await update({ 9: 'skip' });

        expect(server.meta.tsuji_seen_length).toBeUndefined();
        expect(marks()).toEqual({ ...legacy, 9: 'skip' });
        Object.keys(server.meta).forEach((key) => expect(key).toMatch(/^tsuji_seen_(\d|1[0-5])$/));
        Object.values(server.meta).forEach((raw) => expect(() => JSON.parse(raw)).not.toThrow());
    });
});

describe('bucket size guard', () => {
    it(`refuses a write that would push a bucket past ${SEEN_BUCKET_MAX_CHARS} chars and writes nothing`, async () => {
        // ~560 six-digit ids in bucket 0 = ~3,900 chars.
        const full: SeenMarks = Object.fromEntries(
            Array.from({ length: 560 }, (_, index) => [String(100_000 + index * 16), 'read'] as const),
        );
        const { server, update, marks } = createServer();

        const error = await update(full).catch((caught: unknown) => caught);

        expect(error).toBeInstanceOf(SeenBucketFullError);
        expect((error as SeenBucketFullError).bucket).toBe(0);
        expect((error as SeenBucketFullError).length).toBeGreaterThan(SEEN_BUCKET_MAX_CHARS);
        expect(server.writes).toHaveLength(0);
        expect(marks()).toEqual({});
    });

    it('allows a bucket right up to the limit', () => {
        const store = readSeenStore({});
        const ids: string[] = [];
        let next: SeenMarks = {};
        for (let id = 100_000; ; id += 16) {
            const candidate: SeenMarks = { ...next, [id]: 'read' };
            if (serializeSeenBucket(candidate, 0)!.length > SEEN_BUCKET_MAX_CHARS) {
                break;
            }
            next = candidate;
            ids.push(String(id));
        }

        const plan = planSeenWrite(store, next, ids);
        expect(plan.set[0][1].length).toBeLessThanOrEqual(SEEN_BUCKET_MAX_CHARS);
        expect(() => planSeenWrite(store, { ...next, 999_984: 'read' }, ['999984'])).toThrow(SeenBucketFullError);
    });

    it('refuses a migration whose bucket would overflow and keeps the legacy key', async () => {
        const legacy = Object.fromEntries(
            Array.from({ length: 600 }, (_, index) => [String(100_000 + index * 16), 'read']),
        );
        const { server, update } = createServer({ tsuji_seen: JSON.stringify(legacy) });

        await expect(update({})).rejects.toBeInstanceOf(SeenBucketFullError);
        expect(server.meta.tsuji_seen).toBe(JSON.stringify(legacy));
    });
});
