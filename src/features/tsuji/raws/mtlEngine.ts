/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect } from 'react';
import { create } from 'zustand';
import type { MtlStatus } from '@/features/tsuji/raws/mtlStatus.ts';
import { isMtlPending, parseMtlStatus } from '@/features/tsuji/raws/mtlStatus.ts';

/*
 * The MTL engine's per-chapter state (brief #19): `/s` once when a card shows, every 3 s while queued / running /
 * partial and something shows it; `/req` only on a click. Every request goes to the `api` from `tsuji_raw_links` (the
 * relay); nothing else is contacted and nothing is written to Suwayomi.
 */

export const MTL_POLL_MS = 3000;
const TIMEOUT_MS = 8000;

/** `refused`: the signature was rejected (403), never retried. `unreachable`: the engine didn't answer. */
export type MtlError = 'refused' | 'unreachable' | null;

export type MtlChapterRef = { api: string; rawId: number; number: number; req: string };

type Entry = { status: MtlStatus | null; error: MtlError; isRequesting: boolean; isRequested: boolean };

const EMPTY: Entry = { status: null, error: null, isRequesting: false, isRequested: false };

const useEntries = create<Record<string, Entry>>(() => ({}));

export const getMtlKey = ({ api, rawId, number }: Pick<MtlChapterRef, 'api' | 'rawId' | 'number'>) =>
    `${api}|${rawId}|${number}`;

const update = (key: string, patch: Partial<Entry>) =>
    useEntries.setState((entries) => ({ ...entries, [key]: { ...(entries[key] ?? EMPTY), ...patch } }));

export const getMtlEntry = (key: string): Entry => useEntries.getState()[key] ?? EMPTY;

const getJson = async (url: string): Promise<{ status: number; json: unknown }> => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
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

const query = (ref: MtlChapterRef, extra: Record<string, string> = {}) =>
    new URLSearchParams({ raw: String(ref.rawId), ch: String(ref.number), ...extra }).toString();

/** One `/s`. */
export const fetchMtlStatus = async (ref: MtlChapterRef): Promise<void> => {
    const key = getMtlKey(ref);
    try {
        const { status, json } = await getJson(`${ref.api}/s?${query(ref)}`);
        if (status >= 400) {
            throw new Error(String(status));
        }
        update(key, { status: parseMtlStatus(json), error: getMtlEntry(key).error === 'refused' ? 'refused' : null });
    } catch {
        update(key, { error: getMtlEntry(key).error ?? 'unreachable' });
    }
};

/** `/req`: queues the chapter at top priority (twice is harmless); a bad signature is final. */
export const requestMtl = async (ref: MtlChapterRef): Promise<void> => {
    const key = getMtlKey(ref);
    if (getMtlEntry(key).isRequesting || getMtlEntry(key).error === 'refused') {
        return;
    }
    update(key, { isRequesting: true, error: null });
    try {
        const { status, json } = await getJson(`${ref.api}/req?${query(ref, { sig: ref.req })}`);
        const body = json && typeof json === 'object' ? (json as Record<string, unknown>) : {};
        if (status === 403 || body.ok === false) {
            update(key, { isRequesting: false, error: 'refused' });
            return;
        }
        if (status >= 400) {
            throw new Error(String(status));
        }
        update(key, { isRequesting: false, isRequested: true, status: parseMtlStatus(json) });
    } catch {
        update(key, { isRequesting: false, error: 'unreachable' });
    }
};

/** Polls per key, shared by everything that shows it; stops when nobody does or the state settles. */
const pollers = new Map<string, { count: number; timer: ReturnType<typeof setTimeout> | null }>();

const schedule = (ref: MtlChapterRef) => {
    const key = getMtlKey(ref);
    const poller = pollers.get(key);
    if (!poller || poller.timer) {
        return;
    }
    poller.timer = setTimeout(async () => {
        poller.timer = null;
        if (!pollers.has(key)) {
            return;
        }
        await fetchMtlStatus(ref);
        const entry = getMtlEntry(key);
        if (!entry.error && isMtlPending(entry.status)) {
            schedule(ref);
        }
    }, MTL_POLL_MS);
};

const watch = (ref: MtlChapterRef) => {
    const key = getMtlKey(ref);
    const poller = pollers.get(key) ?? { count: 0, timer: null };
    poller.count += 1;
    pollers.set(key, poller);
    return () => {
        poller.count -= 1;
        if (poller.count <= 0) {
            if (poller.timer) {
                clearTimeout(poller.timer);
            }
            pollers.delete(key);
        }
    };
};

/**
 * One chapter's MTL state while shown (`ref` null = nothing to show): `/s` on show, polled while pending; `request`
 * queues it and polls on; `retry` after the engine didn't answer.
 */
export const useMtlChapter = (ref: MtlChapterRef | null) => {
    const key = ref ? getMtlKey(ref) : '';
    const entry = useEntries((entries) => (key ? entries[key] : undefined)) ?? EMPTY;
    const refKey = ref ? `${key}|${ref.req}` : '';

    useEffect(() => {
        if (!ref) {
            return undefined;
        }
        const unwatch = watch(ref);
        fetchMtlStatus(ref).then(() => {
            const current = getMtlEntry(key);
            if (!current.error && isMtlPending(current.status)) {
                schedule(ref);
            }
        });
        return unwatch;
    }, [refKey]);

    // Pending again after a request or a retry: keep polling.
    useEffect(() => {
        if (ref && !entry.error && isMtlPending(entry.status)) {
            schedule(ref);
        }
    }, [refKey, entry.status, entry.error]);

    const request = useCallback(() => {
        if (ref) {
            requestMtl(ref);
        }
    }, [refKey]);
    const retry = useCallback(() => {
        if (ref) {
            update(key, { error: null });
            fetchMtlStatus(ref);
        }
    }, [refKey]);

    return { ...entry, request, retry };
};

/** Tests only. */
export const resetMtlEngine = () => {
    pollers.forEach(({ timer }) => timer && clearTimeout(timer));
    pollers.clear();
    useEntries.setState({}, true);
};
