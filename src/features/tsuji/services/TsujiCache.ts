/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { AppStorage } from '@/lib/storage/AppStorage.ts';

type CacheEntry<T> = { expiresAt: number; value: T };

type IndexEntry = { expiresAt: number; size: number; storedAt: number };

const KEY_PREFIX = 'tsujiCache2:';
const INDEX_KEY = 'tsujiCacheIndex2';

/**
 * localStorage is shared with upstream, which writes without catching quota errors (auth tokens, settings), so the
 * fork's cache stays small: at most ~1 MB total, oversized entries stay in memory only, oldest entries go first.
 */
const MAX_TOTAL_CHARS = 1_000_000;
const MAX_ENTRY_CHARS = 300_000;

/** Session layer: keeps everything working when localStorage is blocked, full, or throws. */
const memoryCache = new Map<string, CacheEntry<unknown>>();

const storageKey = (key: string) => `${KEY_PREFIX}${key}`;

const safely = <T>(fn: () => T, fallback: T): T => {
    try {
        return fn();
    } catch {
        return fallback;
    }
};

const removeStored = (key: string) =>
    safely(() => {
        AppStorage.local.setItem(storageKey(key), undefined, false);
        return true;
    }, false);

const readIndex = (): Record<string, IndexEntry> => {
    const index = safely(() => AppStorage.local.getItemParsed<Record<string, IndexEntry>>(INDEX_KEY, {}), {});
    return index && typeof index === 'object' ? index : {};
};

const writeIndex = (index: Record<string, IndexEntry>): boolean =>
    safely(() => {
        AppStorage.local.setItem(INDEX_KEY, index, false);
        return true;
    }, false);

/** Drops expired entries, then the oldest ones until `incomingSize` fits under the cap. */
const makeRoom = (index: Record<string, IndexEntry>, incomingSize: number, now: number) => {
    const live = Object.entries(index)
        .filter(([key, entry]) => {
            const isLive = typeof entry?.expiresAt === 'number' && entry.expiresAt > now;
            if (!isLive) {
                removeStored(key);
            }
            return isLive;
        })
        .sort((a, b) => a[1].storedAt - b[1].storedAt);

    let total = live.reduce((sum, [, entry]) => sum + (entry.size || 0), 0);
    while (live.length && total + incomingSize > MAX_TOTAL_CHARS) {
        const [key, entry] = live.shift()!;
        removeStored(key);
        total -= entry.size || 0;
    }

    return Object.fromEntries(live);
};

const persist = (key: string, entry: CacheEntry<unknown>) =>
    safely(() => {
        const serialized = JSON.stringify(entry);
        const now = Date.now();
        const { [key]: _previous, ...index } = readIndex();

        const nextIndex = makeRoom(index, serialized.length <= MAX_ENTRY_CHARS ? serialized.length : 0, now);
        if (serialized.length > MAX_ENTRY_CHARS) {
            removeStored(key);
            writeIndex(nextIndex);
            return false;
        }

        AppStorage.local.setItem(storageKey(key), serialized, false);
        const isIndexed = writeIndex({
            ...nextIndex,
            [key]: { expiresAt: entry.expiresAt, size: serialized.length, storedAt: now },
        });
        if (!isIndexed) {
            // Never leave an entry the index can't evict.
            removeStored(key);
        }

        return isIndexed;
    }, false);

export const TsujiCache = {
    get<T>(key: string): T | null {
        const now = Date.now();

        const memoryEntry = memoryCache.get(key);
        if (memoryEntry && memoryEntry.expiresAt > now) {
            return memoryEntry.value as T;
        }

        const stored = safely(() => AppStorage.local.getItemParsed<CacheEntry<T> | null>(storageKey(key), null), null);
        if (!stored || typeof stored.expiresAt !== 'number' || stored.expiresAt <= now) {
            return null;
        }

        memoryCache.set(key, stored);
        return stored.value;
    },

    set<T>(key: string, value: T, ttlMs: number): void {
        const entry: CacheEntry<T> = { expiresAt: Date.now() + ttlMs, value };
        memoryCache.set(key, entry);
        persist(key, entry);
    },

    remove(key: string): void {
        memoryCache.delete(key);
        const { [key]: _removed, ...index } = readIndex();
        removeStored(key);
        writeIndex(index);
    },
};
