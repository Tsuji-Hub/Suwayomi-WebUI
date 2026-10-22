/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import { parseSavedList } from '@/features/tsuji/seen/alListCache.ts';
import { titleKey } from '@/features/tsuji/seen/myList.ts';

const ROWS = [
    [58123, 'PLANNING', 0, 'Maoyuu Maou Yuusha'],
    [85453, 'PAUSED', 47, 'Battle Through the Heavens'],
    [105398, 'COMPLETED', 200, 'Solo Leveling'],
    [7, 'NOT_A_STATUS', 1, 'Broken'],
];

/** The rows' JSON cut into `parts` pieces, as the timer writes it (each value under 4096 characters). */
const split = (parts: number, rows: unknown[] = ROWS) => {
    const json = JSON.stringify(rows);
    const size = Math.ceil(json.length / parts);
    return Object.fromEntries(
        Array.from({ length: parts }, (_, part) => [
            `tsuji_alListCache_${part}`,
            json.slice(part * size, (part + 1) * size),
        ]),
    );
};
const index = (overrides: Record<string, unknown> = {}) => ({
    tsuji_alListCache: JSON.stringify({
        v: 1,
        user: 'ejustice',
        at: 1_792_631_389,
        source: 'seed',
        n: 4,
        parts: 3,
        ...overrides,
    }),
});

describe("the server's copy of the AniList list (brief #17)", () => {
    it('joins the parts in order: rows -> list (id -> status, progress) and title index', () => {
        const saved = parseSavedList({ ...index(), ...split(3) }, 'EJustice');
        expect(saved).toMatchObject({ at: 1_792_631_389, source: 'seed' });
        expect(saved?.list).toEqual({
            58123: ['PLANNING', 0],
            85453: ['PAUSED', 47],
            105398: ['COMPLETED', 200],
        });
        expect(saved?.titleIndex[titleKey('Battle Through the Heavens')!]).toBe(85453);
        expect(saved?.titleIndex[titleKey('Broken')!]).toBeUndefined();
    });

    it('each part its own array works too', () => {
        const meta = {
            ...index({ parts: 2 }),
            tsuji_alListCache_0: JSON.stringify(ROWS.slice(0, 2)),
            tsuji_alListCache_1: JSON.stringify(ROWS.slice(2)),
        };
        expect(Object.keys(parseSavedList(meta, 'ejustice')?.list ?? {})).toHaveLength(3);
    });

    it('nothing when missing, for another user, half-written (parts missing or not matching), or unreadable', () => {
        expect(parseSavedList({}, 'ejustice')).toBeNull();
        expect(parseSavedList({ ...index(), ...split(3) }, 'someone')).toBeNull();
        expect(parseSavedList({ ...index({ parts: 4 }), ...split(3) }, 'ejustice')).toBeNull();
        const { tsuji_alListCache_1: _missing, ...partial } = split(3);
        expect(parseSavedList({ ...index(), ...partial }, 'ejustice')).toBeNull();
        expect(parseSavedList({ ...index(), ...split(3), tsuji_alListCache_2: '{{' }, 'ejustice')).toBeNull();
        expect(parseSavedList({ tsuji_alListCache: 'nope' }, 'ejustice')).toBeNull();
    });
});
