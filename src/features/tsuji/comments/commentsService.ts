/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { getCommentsRelayUrl } from '@/features/tsuji/comments/relayUrl.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { readFreshTsujiRawGlobalMeta, writeTsujiRawGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import type { CommentsCache } from '@/features/tsuji/comments/comickSource.ts';
import { createComickSource, createRelayClient } from '@/features/tsuji/comments/comickSource.ts';
import { resolveComickByAniList } from '@/features/tsuji/comments/aniListResolve.ts';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import { createMatchUpdater, parseCommentMatches } from '@/features/tsuji/comments/commentsMatch.ts';

export {
    getCommentsRelayUrl,
    getDefaultRelayUrl,
    RELAY_PORT,
    resolveRelayUrl,
    setCommentsRelayUrl,
} from '@/features/tsuji/comments/relayUrl.ts';

const memoryThreads = new Map<string, { expiresAt: number; value: unknown }>();

/** Threads (can be hundreds of comments) live in memory only; matches and chapter maps in TsujiCache. */
const cache: CommentsCache = {
    get: <T>(key: string) => {
        if (key.startsWith('comments:thread:')) {
            const entry = memoryThreads.get(key);
            return entry && entry.expiresAt > Date.now() ? (entry.value as T) : null;
        }
        return TsujiCache.get<T>(key);
    },
    set: (key, value, ttlMs) => {
        if (key.startsWith('comments:thread:')) {
            memoryThreads.set(key, { expiresAt: Date.now() + ttlMs, value });
            return;
        }
        TsujiCache.set(key, value, ttlMs);
    },
};

const comickClient = createRelayClient({ getBaseUrl: getCommentsRelayUrl });

export const comickSource = createComickSource({ client: comickClient, cache });

const mangadexClient = createRelayClient({
    getBaseUrl: getCommentsRelayUrl,
    prefix: '/mangadex',
    queue: new SpacedQueue(1000, { burst: 2 }),
});

/** Comick series of an AniList entry, verified by its `links.al` (preview comments). */
export const resolveComickSeriesByAniList = (anilistId: number, titles: string[], signal: AbortSignal) =>
    resolveComickByAniList({ anilistId, titles }, { comick: comickClient, mangadex: mangadexClient, cache }, signal);

export const clearCommentCache = () => {
    memoryThreads.clear();
    TsujiCache.removeByPrefix('comments:');
};

/** Manual matches, merged on write against the server's current value (two devices can't clobber each other). */
export const updateCommentMatches = createMatchUpdater({
    read: async () => parseCommentMatches((await readFreshTsujiRawGlobalMeta())[TSUJI_META_KEYS.commentsMatch]),
    write: (value) => writeTsujiRawGlobalMeta({ set: [[TSUJI_META_KEYS.commentsMatch, value]], delete: [] }),
});
