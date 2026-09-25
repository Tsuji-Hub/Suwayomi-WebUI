/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { AppStorage } from '@/lib/storage/AppStorage.ts';

/**
 * What AniList's degraded mode broke recently (a sort that came back empty or timed out, optional filters that
 * emptied results), remembered for 30 minutes in sessionStorage so later loads go straight to what works.
 * Falls back to module memory when sessionStorage is unavailable.
 */
export const DEGRADED_MEMORY_TTL_MS = 30 * 60 * 1000;

const STORAGE_KEY = 'tsuji:degradedAniList';

type Memory = { sorts: Record<string, number>; relaxFiltersUntil: number };

let inMemory: Memory | null = null;

const read = (): Memory => {
    if (inMemory) {
        return inMemory;
    }

    try {
        const stored = AppStorage.session.getItemParsed<Partial<Memory> | null>(STORAGE_KEY, null);
        inMemory = { sorts: stored?.sorts ?? {}, relaxFiltersUntil: stored?.relaxFiltersUntil ?? 0 };
    } catch {
        inMemory = { sorts: {}, relaxFiltersUntil: 0 };
    }

    return inMemory;
};

const write = (memory: Memory) => {
    inMemory = memory;
    try {
        AppStorage.session.setItem(STORAGE_KEY, memory, false);
    } catch {
        // sessionStorage unavailable: module memory only.
    }
};

export const DegradedMemory = {
    isSortFailed(sort: string, now: number = Date.now()): boolean {
        return (read().sorts[sort] ?? 0) > now;
    },

    rememberSortFailed(sort: string, now: number = Date.now()): void {
        const memory = read();
        write({ ...memory, sorts: { ...memory.sorts, [sort]: now + DEGRADED_MEMORY_TTL_MS } });
    },

    shouldRelaxFilters(now: number = Date.now()): boolean {
        return read().relaxFiltersUntil > now;
    },

    rememberRelaxFilters(now: number = Date.now()): void {
        write({ ...read(), relaxFiltersUntil: now + DEGRADED_MEMORY_TTL_MS });
    },

    /** Tests only. */
    reset(): void {
        inMemory = null;
    },
};
