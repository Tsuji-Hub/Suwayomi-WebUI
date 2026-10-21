/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import { getChipFit, NO_FIT_CHIPS, rankBestMatch } from '@/features/tsuji/recs/bestMatch.ts';
import { getBakaFitChips } from '@/features/tsuji/tags/baka.ts';

const tag = (name: string, rank: number, extra: Partial<RecTag> = {}): RecTag => ({ name, rank, ...extra });

type Card = Pick<RecMedia, 'id' | 'tags' | 'genres' | 'popularity'>;
const card = (id: number, tags: RecTag[], popularity = 1000, genres: string[] = []): Card => ({
    id,
    tags,
    genres,
    popularity,
});
const ids = (cards: Card[]) => cards.map(({ id }) => id);

describe('chip fit', () => {
    it('AniList tag chips by rank, as before: the mean of rank/100 over the chips', () => {
        const chips = { matched: 0, tags: ['Revenge', 'Regression'], genres: [] };
        expect(getChipFit(card(1, [tag('Revenge', 80), tag('Regression', 60)]), chips)).toBeCloseTo(0.7);
        expect(getChipFit(card(2, [tag('Revenge', 80)]), chips)).toBeCloseTo(0.4);
        expect(getChipFit(card(3, [tag('Revenge', 80, { isMediaSpoiler: true })]), chips)).toBe(0);
    });

    it('MangaBaka chips count as matched (a family through any member); post-filter chips on the details', () => {
        // System (family, 3 tags) + Martial Arts (MangaBaka) + an AniList-only genre and tag left as a post-filter.
        const chips = getBakaFitChips({
            includeSets: [[3081, 1171, 1196], [77]],
            postFilter: { genres: { Action: 'include', Ecchi: 'exclude' }, tags: { Medicine: 'include' } },
        });
        expect(chips).toEqual({ matched: 2, tags: ['Medicine'], genres: ['Action'] });
        expect(getChipFit(card(1, [tag('Medicine', 50)], 1, ['Action']), chips)).toBeCloseTo((2 + 0.5 + 1) / 4);
        expect(getChipFit(card(2, [], 1, []), chips)).toBeCloseTo(2 / 4);
    });

    it('no included chip: no fit', () => expect(getChipFit(card(1, [tag('Revenge', 90)]), NO_FIT_CHIPS)).toBe(0));
});

describe('Best match', () => {
    const chips = { matched: 0, tags: ['Martial Arts'], genres: [] };
    const page = [
        card(1, [tag('Martial Arts', 90), tag('Male Protagonist', 90)], 90_000),
        card(2, [tag('Martial Arts', 90), tag('Medicine', 80)], 2000),
        card(3, [tag('Martial Arts', 40), tag('Medicine', 90)], 50_000),
        card(4, [tag('Medicine', 100)], 99_000),
    ];

    it('without a profile: chip fit, ties by popularity', () =>
        expect(ids(rankBestMatch(page, chips, null))).toEqual([1, 2, 3, 4]));

    it('with a profile: 0.6 fit + 0.4 taste (normalized on the page); the card without the chip stays last', () => {
        // Fit .9/.9/.4/0, taste .09/.8/.9/1 of the strongest: .576, .86, .6, .4.
        const ranked = ids(rankBestMatch(page, chips, { Medicine: 1, 'Male Protagonist': 0.1 }));
        expect(ranked).toEqual([2, 3, 1, 4]);
    });

    it('the taste orders cards that all match (MangaBaka), ties keep the page order', () => {
        const all = { matched: 1, tags: [], genres: [] };
        const weights = { Medicine: 1 };
        expect(ids(rankBestMatch(page, all, weights, 'order'))).toEqual([4, 3, 2, 1]);
        expect(ids(rankBestMatch([card(7, []), card(5, []), card(6, [])], all, weights, 'order'))).toEqual([7, 5, 6]);
    });
});
