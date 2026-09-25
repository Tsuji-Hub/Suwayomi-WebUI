/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { mergeCandidates } from '@/features/tsuji/recs/merge.ts';
import { abbreviateCount, getComicType, getContentTags, getDisplayTitle } from '@/features/tsuji/recs/media.ts';

const media = (id: number) => ({ id }) as RecMedia;

describe('mergeCandidates', () => {
    const merged = mergeCandidates({
        seedId: 100,
        edges: [
            { rating: 40, media: media(1) },
            { rating: null, media: media(2) },
            { rating: 5, media: null },
            { rating: 9, media: media(100) },
        ],
        recall: [media(1), media(3)],
        malMapped: [media(2), media(4), media(100)],
    });
    const byId = new Map(merged.map((candidate) => [candidate.id, candidate]));

    it('dedupes by AniList id and drops the seed and empty edges', () =>
        expect([...byId.keys()].sort()).toEqual([1, 2, 3, 4]));

    it('unions sources', () => {
        expect(byId.get(1)?.sources).toEqual(['anilist', 'tags']);
        expect(byId.get(2)?.sources).toEqual(['anilist', 'mal']);
    });

    it('keeps the edge rating and defaults the rest to 0', () => {
        expect(byId.get(1)?.edgeRating).toBe(40);
        expect(byId.get(2)?.edgeRating).toBe(0);
        expect(byId.get(4)?.edgeRating).toBe(0);
    });
});

describe('media helpers', () => {
    it('abbreviates counts', () =>
        expect([999, 1450, 2000, 2_300_000].map(abbreviateCount)).toEqual(['999', '1.4k', '2k', '2.3M']));

    it('maps country to type', () =>
        expect(['KR', 'JP', 'CN', 'TW', 'US', null].map(getComicType)).toEqual([
            'MANHWA',
            'MANGA',
            'MANHUA',
            'MANHUA',
            null,
            null,
        ]));

    it('prefers the English title', () => {
        expect(getDisplayTitle({ title: { english: 'Reborn Rich', userPreferred: 'Jaebeoljip', romaji: null } })).toBe(
            'Reborn Rich',
        );
        expect(getDisplayTitle({ title: { english: null, userPreferred: 'Jaebeoljip', romaji: null } })).toBe(
            'Jaebeoljip',
        );
    });

    it('content tags drop spoilers and technical tags, highest rank first', () =>
        expect(
            getContentTags({
                tags: [
                    { name: 'Long Strip', rank: 95, category: 'Technical' },
                    { name: 'Revenge', rank: 66, category: 'Theme-Drama' },
                    { name: 'Twist', rank: 99, isMediaSpoiler: true },
                    { name: 'Economics', rank: 86, category: 'Theme-Other' },
                ],
            }).map(({ name }) => name),
        ).toEqual(['Economics', 'Revenge']));
});
