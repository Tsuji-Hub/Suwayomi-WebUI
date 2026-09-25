/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
let shouldThrow = false;

vi.mock('@/lib/storage/AppStorage.ts', () => ({
    AppStorage: {
        local: {
            getItemParsed: (key: string, fallback: unknown) => {
                if (shouldThrow) {
                    throw new Error('SecurityError');
                }
                const raw = store.get(key);
                return raw === undefined ? fallback : JSON.parse(raw);
            },
            setItem: (key: string, value: unknown) => {
                if (shouldThrow) {
                    throw new Error('QuotaExceededError');
                }
                if (value === undefined) {
                    store.delete(key);
                    return;
                }
                store.set(key, typeof value === 'string' ? value : JSON.stringify(value));
            },
        },
    },
}));

const { TsujiCache } = await import('@/features/tsuji/services/TsujiCache.ts');

const HOUR = 60 * 60 * 1000;
const storedKeys = () => [...store.keys()].filter((key) => key.startsWith('tsujiCache2:'));
const storedChars = () => storedKeys().reduce((sum, key) => sum + store.get(key)!.length, 0);

describe('TsujiCache', () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        store.clear();
        shouldThrow = false;
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('round-trips and expires values', () => {
        TsujiCache.set('a', { n: 1 }, HOUR);
        expect(TsujiCache.get('a')).toEqual({ n: 1 });

        vi.setSystemTime(HOUR + 1);
        expect(TsujiCache.get('a')).toBeNull();
    });

    it('keeps localStorage under the cap by evicting the oldest entries', () => {
        const blob = 'x'.repeat(200_000);
        ['k1', 'k2', 'k3', 'k4', 'k5', 'k6'].forEach((key, index) => {
            vi.setSystemTime(index);
            TsujiCache.set(key, blob, HOUR);
        });

        expect(storedChars()).toBeLessThanOrEqual(1_000_000);
        expect(storedKeys()).not.toContain('tsujiCache2:k1');
        expect(storedKeys()).toContain('tsujiCache2:k6');
    });

    it('keeps oversized entries in memory only', () => {
        TsujiCache.set('big', 'x'.repeat(400_000), HOUR);

        expect(storedKeys()).toEqual([]);
        expect(TsujiCache.get('big')).toHaveLength(400_000);
    });

    it('purges expired entries on write', () => {
        TsujiCache.set('old', 1, 10);
        vi.setSystemTime(20);
        TsujiCache.set('new', 2, HOUR);

        expect(storedKeys()).toEqual(['tsujiCache2:new']);
    });

    it('works when storage throws', () => {
        shouldThrow = true;

        expect(() => TsujiCache.set('s', 'value', HOUR)).not.toThrow();
        expect(TsujiCache.get('s')).toBe('value');
        expect(() => TsujiCache.remove('s')).not.toThrow();
    });
});
