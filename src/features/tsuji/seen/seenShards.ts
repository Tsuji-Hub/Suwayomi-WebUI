/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { SeenMark, SeenMarks, SeenPatch } from '@/features/tsuji/seen/seen.ts';
import { applySeenPatch, parseSeenMarks } from '@/features/tsuji/seen/seen.ts';

/**
 * Suwayomi rejects global meta values over 4096 chars, so the marks are sharded into SEEN_SHARD_COUNT keys
 * (`tsuji_seen_0` .. `tsuji_seen_15`, bucket = mediaId % 16), each `{"r":[ids],"s":[ids]}`. A write only touches the
 * buckets of the changed titles. The old single `tsuji_seen` key is read, migrated into the shards and deleted.
 */
export const SEEN_SHARD_COUNT = 16;

/** Headroom under the server's 4096 chars; also keeps upstream's metadata chunker (4000) out of the way. */
export const SEEN_BUCKET_MAX_CHARS = 3800;

const LEGACY_KEY = TSUJI_META_KEYS.seen;

/** Upstream's chunker would have stored an oversized legacy value as `tsuji_seen_<i>` + `tsuji_seen_length`. */
const LEGACY_CHUNK_LENGTH_KEY = `${LEGACY_KEY}_length`;

export const getSeenShardKey = (bucket: number) => `${LEGACY_KEY}_${bucket}`;

export const SEEN_SHARD_KEYS = Array.from({ length: SEEN_SHARD_COUNT }, (_, bucket) => getSeenShardKey(bucket));

/** Every global meta key the marks can live in (shards, legacy key, legacy chunk count). */
export const isSeenMetaKey = (key: string) =>
    key === LEGACY_KEY || key === LEGACY_CHUNK_LENGTH_KEY || key.startsWith(`${LEGACY_KEY}_`);

export const getSeenBucket = (mediaId: number | string) => Number(mediaId) % SEEN_SHARD_COUNT;

export class SeenBucketFullError extends Error {
    constructor(
        readonly bucket: number,
        readonly length: number,
    ) {
        super(`tsuji_seen bucket ${bucket} would be ${length} chars (max ${SEEN_BUCKET_MAX_CHARS}); nothing was saved`);
        this.name = 'SeenBucketFullError';
    }
}

type RawMeta = Partial<Record<string, string>>;

const MARK_BY_FIELD: Record<'r' | 's', SeenMark> = { r: 'read', s: 'skip' };

const ascending = (a: number, b: number) => a - b;

const isMediaId = (value: unknown): value is number => Number.isInteger(value) && (value as number) > 0;

/** Tolerant parse of one bucket: anything that isn't a positive id in "r" or "s" is dropped. */
export const parseSeenBucket = (raw: string | undefined): SeenMarks => {
    if (!raw) {
        return {};
    }

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        return {};
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        return {};
    }

    const marks: SeenMarks = {};
    (['r', 's'] as const).forEach((field) => {
        const ids = (parsed as Record<string, unknown>)[field];
        if (Array.isArray(ids)) {
            ids.filter(isMediaId).forEach((id) => {
                marks[String(id)] = MARK_BY_FIELD[field];
            });
        }
    });

    return marks;
};

/** `{"r":[...],"s":[...]}` for the marks in `bucket` (ids ascending, so equal content = equal string); null if empty. */
export const serializeSeenBucket = (marks: SeenMarks, bucket: number): string | null => {
    const r: number[] = [];
    const s: number[] = [];

    Object.entries(marks).forEach(([key, mark]) => {
        if (getSeenBucket(key) === bucket) {
            (mark === 'read' ? r : s).push(Number(key));
        }
    });

    if (!r.length && !s.length) {
        return null;
    }

    return JSON.stringify({ r: r.sort(ascending), s: s.sort(ascending) });
};

export type SeenStore = {
    marks: SeenMarks;
    /** Raw shard values by bucket, as stored (undefined = key absent). */
    shards: (string | undefined)[];
    /** Legacy keys still on the server; non-empty means the next write migrates. */
    legacyKeys: string[];
};

const readLegacy = (meta: RawMeta): { marks: SeenMarks; keys: string[] } => {
    const chunkCount = Number(meta[LEGACY_CHUNK_LENGTH_KEY]);

    if (meta[LEGACY_CHUNK_LENGTH_KEY] !== undefined && Number.isInteger(chunkCount) && chunkCount > 0) {
        const chunkKeys = Array.from({ length: chunkCount }, (_, index) => getSeenShardKey(index));
        const value = chunkKeys.map((key) => meta[key] ?? '').join('');
        const keys = [LEGACY_CHUNK_LENGTH_KEY, ...chunkKeys];
        if (meta[LEGACY_KEY] !== undefined) {
            keys.push(LEGACY_KEY);
        }

        return { marks: parseSeenMarks(value), keys };
    }

    if (meta[LEGACY_KEY] !== undefined) {
        return { marks: parseSeenMarks(meta[LEGACY_KEY]), keys: [LEGACY_KEY] };
    }

    return { marks: {}, keys: [] };
};

/** Marks from raw (un-reassembled) global meta: legacy value first, shards win over it. */
export const readSeenStore = (meta: RawMeta): SeenStore => {
    const legacy = readLegacy(meta);
    // In the chunked legacy layout `tsuji_seen_<i>` hold chunk text, not shards.
    const isChunkedLegacy = legacy.keys.includes(LEGACY_CHUNK_LENGTH_KEY);
    const shards = SEEN_SHARD_KEYS.map((key) => (isChunkedLegacy ? undefined : meta[key]));

    const marks: SeenMarks = { ...legacy.marks };
    shards.forEach((raw) => Object.assign(marks, parseSeenBucket(raw)));

    return { marks, shards, legacyKeys: legacy.keys };
};

export type SeenWritePlan = { set: [key: string, value: string][]; delete: string[] };

export const isEmptySeenWritePlan = (plan: SeenWritePlan) => !plan.set.length && !plan.delete.length;

/**
 * Keys to write for `next`: only the buckets of `changedKeys` (all buckets while legacy keys remain, which migrates
 * them), empty buckets deleted, unchanged buckets skipped, legacy keys deleted. Throws SeenBucketFullError before
 * anything is written if a bucket would pass SEEN_BUCKET_MAX_CHARS.
 */
export const planSeenWrite = (store: SeenStore, next: SeenMarks, changedKeys: string[]): SeenWritePlan => {
    const isMigrating = store.legacyKeys.length > 0;
    const buckets = isMigrating
        ? SEEN_SHARD_KEYS.map((_, bucket) => bucket)
        : [...new Set(changedKeys.map(getSeenBucket))].sort(ascending);

    const plan: SeenWritePlan = { set: [], delete: [] };

    buckets.forEach((bucket) => {
        const key = getSeenShardKey(bucket);
        const value = serializeSeenBucket(next, bucket);
        const stored = store.shards[bucket];

        if (value === null) {
            if (stored !== undefined) {
                plan.delete.push(key);
            }
            return;
        }

        if (value.length > SEEN_BUCKET_MAX_CHARS) {
            throw new SeenBucketFullError(bucket, value.length);
        }

        if (value !== stored) {
            plan.set.push([key, value]);
        }
    });

    const setKeys = new Set(plan.set.map(([key]) => key));
    store.legacyKeys
        .filter((key) => !setKeys.has(key) && !plan.delete.includes(key))
        .forEach((key) => plan.delete.push(key));

    return plan;
};

/**
 * Merge-on-write for the marks: every update reads all buckets from the server in one request, applies only this
 * change, then writes only the touched buckets in one request, so two devices marking different titles don't
 * clobber each other. Updates from this tab are serialized so quick successive marks can't race each other either.
 */
export const createSeenUpdater = ({
    read,
    write,
}: {
    read: () => Promise<SeenStore>;
    write: (plan: SeenWritePlan) => Promise<void>;
}) => {
    let queue: Promise<unknown> = Promise.resolve();

    return (patch: SeenPatch | ((current: SeenMarks) => SeenPatch)): Promise<SeenMarks> => {
        const run = queue.then(async () => {
            const store = await read();
            const changes = typeof patch === 'function' ? patch(store.marks) : patch;
            const next = applySeenPatch(store.marks, changes);
            const plan = planSeenWrite(store, next, Object.keys(changes));
            if (!isEmptySeenWritePlan(plan)) {
                await write(plan);
            }
            return next;
        });
        queue = run.catch(() => undefined);

        return run;
    };
};
