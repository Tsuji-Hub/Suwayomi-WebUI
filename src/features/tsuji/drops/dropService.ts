/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { useTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { resolveRelayUrl } from '@/features/tsuji/comments/relayUrl.ts';
import type { DropData, DropIndex, DropLine } from '@/features/tsuji/drops/drops.ts';
import {
    fromStatusDistribution,
    getDataDropLine,
    getIndexDropLine,
    parseDropData,
    parseDropIndex,
} from '@/features/tsuji/drops/drops.ts';

/*
 * Drop data (brief #20): the relay's `/drops` (al-drops on CT100) first, AniList's statusDistribution when the relay
 * doesn't answer. Nothing here runs in the reader; everything is lazy and cached for the session.
 */

const TIMEOUT_MS = 8000;
/**
 * The preview line waits longer: a cold title makes the relay ask AniList first, and giving up earlier cut that request
 * (relay 499) and cost an AniList call on top (r3452 check).
 */
const LINE_TIMEOUT_MS = 30_000;
/** Series answers and the index are kept this long in the session. */
const CACHE_TTL_MS = 10 * 60 * 1000;
export const MAP_POLL_MS = 5000;
export const MAP_POLL_LIMIT_MS = 2 * 60 * 1000;

/** `<relay>/drops`, from `tsuji_commentsRelay` like the comments and the MTL feed. */
export const useDropsBase = (): string => {
    const meta = useTsujiGlobalMeta();
    return `${resolveRelayUrl(meta[TSUJI_META_KEYS.commentsRelay]).replace(/\/+$/, '')}/drops`;
};

/**
 * `data`: an answer; `mapping`: the relay is still building it and has no numbers yet; `none`: the relay knows
 * nothing (404, 503); `unreachable`: no answer (relay down).
 */
export type DropFetch =
    | { kind: 'data'; data: DropData }
    | { kind: 'mapping' }
    | { kind: 'none' }
    | { kind: 'unreachable' };

const isMappingAnswer = (json: unknown) =>
    !!json && typeof json === 'object' && (json as { map?: { state?: unknown } }).map?.state === 'pending';

const getJson = async (url: string, timeoutMs = TIMEOUT_MS): Promise<{ status: number; json: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetch(url, {
            signal: controller.signal,
            cache: 'no-store',
            credentials: 'omit',
            headers: { Accept: 'application/json' },
        });
        return { status: response.status, json: await response.json().catch(() => null) };
    } finally {
        clearTimeout(timer);
    }
};

/** One `/drops/<anilistId>`. */
export const fetchDropData = async (base: string, anilistId: number, timeoutMs = TIMEOUT_MS): Promise<DropFetch> => {
    try {
        const { status, json } = await getJson(`${base}/${anilistId}`, timeoutMs);
        if (status === 404 || status === 503) {
            return { kind: 'none' };
        }
        const data = status < 400 ? parseDropData(json) : null;
        if (data) {
            return { kind: 'data', data };
        }
        return status < 400 && isMappingAnswer(json) ? { kind: 'mapping' } : { kind: 'unreachable' };
    } catch {
        return { kind: 'unreachable' };
    }
};

export const DROP_STATS_QUERY = `
    query TsujiDropStats($id: Int) {
        Media(id: $id, type: MANGA) {
            id
            chapters
            stats { statusDistribution { status amount } }
        }
    }
`;

type DropStatsResponse = {
    Media: {
        id: number;
        chapters: number | null;
        stats: { statusDistribution: { status: string | null; amount: number | null }[] | null } | null;
    } | null;
};

const tier1 = new Map<number, { at: number; data: Promise<DropData | null> }>();

/** The drop rate straight from AniList (no map), one request per title and session. */
export const loadTier1 = (anilistId: number): Promise<DropData | null> => {
    const cached = tier1.get(anilistId);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
        return cached.data;
    }
    const data = aniList
        .request<DropStatsResponse>(DROP_STATS_QUERY, { id: anilistId }, { timeoutMs: ANILIST_TIMEOUT_MS.slow })
        .then(({ Media }) =>
            Media ? fromStatusDistribution(Media.id, Media.chapters, Media.stats?.statusDistribution) : null,
        )
        .catch(() => null);
    tier1.set(anilistId, { at: Date.now(), data });
    return data;
};

type IndexCache = { base: string; at: number; index: DropIndex | null; pending: Promise<void> | null };
const indexCache: IndexCache = { base: '', at: 0, index: null, pending: null };
const indexListeners = new Set<() => void>();

/** `/drops/index.json`, once per 10 minutes (one request for every card on screen). */
const loadDropIndex = (base: string): Promise<void> => {
    if (indexCache.base === base && (indexCache.pending || Date.now() - indexCache.at < CACHE_TTL_MS)) {
        return indexCache.pending ?? Promise.resolve();
    }
    indexCache.base = base;
    indexCache.pending = getJson(`${base}/index.json`)
        .then(({ status, json }) => {
            indexCache.index = status < 400 ? parseDropIndex(json) : indexCache.index;
        })
        .catch(() => {
            // Cards just show no chip; the series page has its own fallback.
        })
        .finally(() => {
            indexCache.at = Date.now();
            indexCache.pending = null;
            indexListeners.forEach((listener) => listener());
        });
    return indexCache.pending;
};

/** The index (null until loaded, or when the relay has none); `enabled` false asks nothing. */
export const useDropIndex = (enabled = true): DropIndex | null => {
    const base = useDropsBase();
    const [, setVersion] = useState(0);

    useEffect(() => {
        const listener = () => setVersion((version) => version + 1);
        indexListeners.add(listener);
        if (enabled) {
            loadDropIndex(base);
        }
        return () => {
            indexListeners.delete(listener);
        };
    }, [base, enabled]);

    return indexCache.base === base ? indexCache.index : null;
};

/** The index and whether its request is over (null when it failed or the relay has none). */
export const useDropIndexState = (enabled = true): { index: DropIndex | null; isSettled: boolean } => {
    const index = useDropIndex(enabled);
    const base = useDropsBase();
    return { index, isSettled: indexCache.base === base && indexCache.at > 0 && !indexCache.pending };
};

/** The index as last loaded (sorting outside React). */
export const getDropIndexSnapshot = (): DropIndex | null => indexCache.index;

export type SeriesDrops =
    | { status: 'loading' }
    | { status: 'none' }
    | { status: 'ready'; data: DropData; isMapping: boolean };

const seriesCache = new Map<string, { at: number; data: DropData }>();

/**
 * The series page's drop data: the relay's answer (polled every 5 s for 2 minutes while its map is being built, the
 * drop rate shown meanwhile), else AniList's drop rate; `none` hides the block. Never blocks the page.
 */
export const useSeriesDrops = (anilistId: number | null): SeriesDrops => {
    const base = useDropsBase();
    const key = anilistId ? `${base}|${anilistId}` : '';
    const [result, setResult] = useState<{ key: string; state: SeriesDrops }>({
        key: '',
        state: { status: 'loading' },
    });

    useEffect(() => {
        if (!anilistId) {
            return undefined;
        }
        let isCurrent = true;
        let timer: ReturnType<typeof setTimeout> | null = null;
        const startedAt = Date.now();
        const publish = (state: SeriesDrops) => isCurrent && setResult({ key, state });

        const cached = seriesCache.get(key);
        if (cached && Date.now() - cached.at < CACHE_TTL_MS && cached.data.map?.state !== 'pending') {
            publish({ status: 'ready', data: cached.data, isMapping: false });
            return () => {
                isCurrent = false;
            };
        }

        const load = async () => {
            const answer = await fetchDropData(base, anilistId);
            if (!isCurrent) {
                return;
            }
            if (answer.kind === 'none') {
                publish({ status: 'none' });
                return;
            }
            const canWait = Date.now() - startedAt < MAP_POLL_LIMIT_MS;
            if (answer.kind === 'unreachable' || answer.kind === 'mapping') {
                // AniList's drop rate meanwhile (one request, cached); the map comes when the relay has it.
                const data = await loadTier1(anilistId);
                const isMapping = answer.kind === 'mapping' && canWait;
                if (!isCurrent) {
                    return;
                }
                publish(data ? { status: 'ready', data, isMapping } : { status: isMapping ? 'loading' : 'none' });
                if (isMapping) {
                    timer = setTimeout(load, MAP_POLL_MS);
                }
                return;
            }
            const isPending = answer.data.map?.state === 'pending';
            publish({ status: 'ready', data: answer.data, isMapping: isPending && canWait });
            if (isPending && canWait) {
                timer = setTimeout(load, MAP_POLL_MS);
                return;
            }
            seriesCache.set(key, { at: Date.now(), data: answer.data });
        };
        publish({ status: 'loading' });
        load();

        return () => {
            isCurrent = false;
            if (timer) {
                clearTimeout(timer);
            }
        };
    }, [key]);

    return result.key === key && key ? result.state : { status: anilistId ? 'loading' : 'none' };
};

const lineCache = new Map<string, Promise<DropLine | null>>();

/**
 * A preview's drop line for a title outside the index: one shared `/drops/<id>` per title and session, never cut short
 * by the preview closing (the answer is kept for the next one). AniList's rate only on a relay error or timeout; nothing
 * on a 404; while the relay is still mapping, nothing now and a fresh request on the next open.
 */
const loadDropLine = (base: string, anilistId: number): Promise<DropLine | null> => {
    const key = `${base}|${anilistId}`;
    const cached = lineCache.get(key);
    if (cached) {
        return cached;
    }
    const line = fetchDropData(base, anilistId, LINE_TIMEOUT_MS).then(async (answer) => {
        switch (answer.kind) {
            case 'data':
                return getDataDropLine(answer.data);
            case 'none':
                return null;
            case 'mapping':
                lineCache.delete(key);
                return null;
            default: {
                const data = await loadTier1(anilistId);
                return data ? getDataDropLine(data) : null;
            }
        }
    });
    lineCache.set(key, line);
    return line;
};

/** The preview / hover drop line: from the index, else one lazy request once the index has answered without it. */
export const useDropLine = (anilistId: number | null): DropLine | null => {
    const base = useDropsBase();
    const { index, isSettled } = useDropIndexState(!!anilistId);
    const item = anilistId ? index?.items.get(anilistId) : undefined;
    const key = anilistId ? `${base}|${anilistId}` : '';
    const [fetched, setFetched] = useState<{ key: string; line: DropLine | null } | null>(null);

    useEffect(() => {
        if (!anilistId || item || !isSettled) {
            return undefined;
        }
        let isCurrent = true;
        loadDropLine(base, anilistId).then((line) => isCurrent && setFetched({ key, line }));
        return () => {
            isCurrent = false;
        };
    }, [key, !!item, isSettled]);

    if (item) {
        return getIndexDropLine(item);
    }
    return fetched?.key === key ? fetched.line : null;
};

/** Tests only. */
export const resetDropCaches = () => {
    tier1.clear();
    seriesCache.clear();
    lineCache.clear();
    Object.assign(indexCache, { base: '', at: 0, index: null, pending: null });
};
