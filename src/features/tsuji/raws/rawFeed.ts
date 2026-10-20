/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useState } from 'react';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { useTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { resolveRelayUrl } from '@/features/tsuji/comments/commentsService.ts';
import type { RawFeedRow } from '@/features/tsuji/raws/rawLinks.ts';
import { parseRawFeed } from '@/features/tsuji/raws/rawLinks.ts';

const FEED_TTL_MS = 60_000;
const FEED_TIMEOUT_MS = 5000;

type FeedCache = { url: string; at: number; rows: Map<number, RawFeedRow> | null; pending: Promise<void> | null };
const cache: FeedCache = { url: '', at: 0, rows: null, pending: null };
const listeners = new Set<() => void>();

/** The action feed through the comments relay (`<relay>/mtl/raws.json`), one request a minute at most. */
const loadFeed = (url: string, force: boolean): Promise<void> => {
    if (cache.pending && cache.url === url) {
        return cache.pending;
    }
    if (!force && cache.url === url && cache.rows && Date.now() - cache.at < FEED_TTL_MS) {
        return Promise.resolve();
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FEED_TIMEOUT_MS);
    cache.url = url;
    cache.pending = fetch(url, {
        signal: controller.signal,
        cache: 'no-store',
        headers: { Accept: 'application/json' },
    })
        .then((response) => (response.ok ? response.json() : null))
        .then((json: unknown) => {
            cache.rows = parseRawFeed(json);
        })
        // The feed is optional (chips from meta still show); a down relay is not an error here.
        .catch(() => {
            cache.rows = cache.rows ?? new Map();
        })
        .finally(() => {
            clearTimeout(timer);
            cache.at = Date.now();
            cache.pending = null;
            listeners.forEach((listener) => listener());
        });
    return cache.pending;
};

/** The feed row of an English manga (undefined while loading or when the feed has none), and a refresh. */
export const useRawFeedRow = (enId: number | null | undefined) => {
    const meta = useTsujiGlobalMeta();
    const url = `${resolveRelayUrl(meta[TSUJI_META_KEYS.commentsRelay]).replace(/\/+$/, '')}/mtl/raws.json`;
    const [, setVersion] = useState(0);

    useEffect(() => {
        const listener = () => setVersion((version) => version + 1);
        listeners.add(listener);
        if (enId) {
            loadFeed(url, false);
        }
        return () => {
            listeners.delete(listener);
        };
    }, [url, enId]);

    const refresh = useCallback(() => loadFeed(url, true), [url]);
    const row = enId && cache.url === url ? cache.rows?.get(enId) : undefined;

    return { row, isLoaded: cache.url === url && !!cache.rows, refresh };
};
