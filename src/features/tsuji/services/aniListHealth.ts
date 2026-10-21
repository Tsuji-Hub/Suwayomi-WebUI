/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Whether AniList is down (brief #15). AniList switched its API off for a day in 2026-10 (403 "The AniList API has
 * been temporarily disabled due to severe stability issues"); it was degraded for weeks in 2026-09. Down = a 403
 * saying so, a 5xx, a network error, or no answer within 8 s. Remembered for 30 minutes (sessionStorage, like
 * DegradedMemory); meanwhile nothing goes to AniList except one probe every 5 minutes (and one right after a
 * reload), and Discover, Similar and For You fall back to Comick and MangaBaka. Kept free of the app's storage layer so the AniList client (and its
 * tests) can use it.
 */

export const ANILIST_DOWN_TTL_MS = 30 * 60 * 1000;
export const ANILIST_PROBE_INTERVAL_MS = 5 * 60 * 1000;
/** A request still unanswered after this long counts as AniList being down. */
export const ANILIST_DOWN_AFTER_MS = 8000;

const STORAGE_KEY = 'tsuji:aniListDown';

export type AniListHealthState = {
    /** 0 = up. */
    downUntil: number;
    lastError: string | null;
    failedAt: number;
    /** When the next probe may go out while down. */
    nextProbeAt: number;
};

const UP: AniListHealthState = { downUntil: 0, lastError: null, failedAt: 0, nextProbeAt: 0 };

/** A failure that means AniList itself is unavailable (not a bad query, not a rate limit). */
export const isAniListDownSignal = ({
    status,
    message,
    isNetworkError = false,
    waitedMs = 0,
}: {
    status?: number;
    message?: string;
    isNetworkError?: boolean;
    /** How long the request went unanswered before it was given up. */
    waitedMs?: number;
}): boolean =>
    isNetworkError ||
    waitedMs >= ANILIST_DOWN_AFTER_MS ||
    (status !== undefined && status >= 500 && status < 600) ||
    (status === 403 && /disabled|stability|maintenance/i.test(message ?? ''));

const readStored = (): AniListHealthState => {
    try {
        const raw = globalThis.sessionStorage?.getItem(STORAGE_KEY);
        const parsed = raw ? (JSON.parse(raw) as Partial<AniListHealthState>) : null;
        // A reload asks AniList once at once (the probe): a reload is how a user says "try again".
        return parsed && typeof parsed.downUntil === 'number' ? { ...UP, ...parsed, nextProbeAt: 0 } : UP;
    } catch {
        return UP;
    }
};

let state: AniListHealthState | null = null;
const listeners = new Set<() => void>();

const read = () => {
    state ??= readStored();
    return state;
};

const write = (next: AniListHealthState) => {
    state = next;
    try {
        globalThis.sessionStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
        // sessionStorage unavailable: module memory only.
    }
    listeners.forEach((listener) => listener());
};

export const AniListHealth = {
    getState: (): AniListHealthState => read(),

    isDown: (now: number = Date.now()): boolean => read().downUntil > now,

    /**
     * Whether a request may go to AniList now: always while up; while down, only the first one after the probe
     * interval (it claims the probe slot, the rest are refused without a request).
     */
    claimRequest: (now: number = Date.now()): 'up' | 'probe' | 'blocked' => {
        const current = read();
        if (current.downUntil <= now) {
            return 'up';
        }
        if (current.nextProbeAt > now) {
            return 'blocked';
        }
        write({ ...current, nextProbeAt: now + ANILIST_PROBE_INTERVAL_MS });
        return 'probe';
    },

    reportDown: (message: string, now: number = Date.now()): void =>
        write({
            downUntil: now + ANILIST_DOWN_TTL_MS,
            lastError: message,
            failedAt: now,
            nextProbeAt: now + ANILIST_PROBE_INTERVAL_MS,
        }),

    /** Any answer from AniList (even an error about the query) means it is back. */
    reportUp: (): void => {
        if (read().downUntil) {
            write(UP);
        }
    },

    subscribe: (listener: () => void): (() => void) => {
        listeners.add(listener);
        return () => {
            listeners.delete(listener);
        };
    },

    /** Tests only. */
    reset: (): void => {
        state = UP;
    },
};
