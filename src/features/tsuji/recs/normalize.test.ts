/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import { findExactTitleMatch, normalizeTitle, titlesMatch } from '@/features/tsuji/recs/normalize.ts';

describe('normalizeTitle', () => {
    it('strips bracketed spans', () => {
        expect(normalizeTitle('Reborn Rich (Official)')).toBe('reborn rich');
        expect(normalizeTitle('Solo Leveling [Webtoon]')).toBe('solo leveling');
    });

    it('folds accents and punctuation', () => {
        expect(normalizeTitle('Pokémon')).toBe('pokemon');
        expect(normalizeTitle('The S-Classes That I Raised')).toBe('the s classes that i raised');
    });

    it('turns non-latin titles into an empty key', () => expect(normalizeTitle('화산귀환')).toBe(''));
    it('handles missing titles', () => expect(normalizeTitle(null)).toBe(''));
});

describe('titlesMatch', () => {
    it('matches normalized equals', () => expect(titlesMatch('Reborn Rich!', 'reborn rich')).toBe(true));
    it('never matches empty keys', () => expect(titlesMatch('화산귀환', '화산귀환')).toBe(false));
});

describe('findExactTitleMatch', () => {
    it('accepts only exact normalized title or synonym matches', () =>
        expect(
            findExactTitleMatch('Reborn Rich', [
                { id: 1, titles: ['Reborn Rich 2'] },
                { id: 2, titles: ['Jaebeoljip Mangnaeadeul', null, 'Reborn Rich'] },
            ]),
        ).toBe(2));

    it('returns null without a match', () =>
        expect(findExactTitleMatch('Reborn Rich', [{ id: 1, titles: ['Reborn'] }])).toBeNull());
});
