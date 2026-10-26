/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getAllTitles } from '@/features/tsuji/recs/media.ts';
import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';
import type { ListTitleIndex } from '@/features/tsuji/seen/myList.ts';
import type { ComickRecommendation } from '@/features/tsuji/comick/comickCatalog.ts';
import { adoptListIds } from '@/features/tsuji/comick/listMatch.ts';

/** Shorter loose keys (a CJK word, an initialism) say too little to match on. */
const MIN_LOOSE_KEY = 4;
/** A Comick title with a junk number tacked on ("...Divine Pets!404"): 3+ digits, so "Title 2" stays a sequel. */
const JUNK_SUFFIX = /^\d{3,}$/;

/**
 * A card's title keys: the usual normalized ones, and a Unicode-wide one (letters and digits of any script) so that two
 * Comick entries sharing a Chinese or Korean title match too.
 */
const titleKeys = (media: Pick<RecMedia, 'title'>): string[] => {
    const titles = getAllTitles(media);
    const loose = titles
        .map((title) =>
            (title ?? '')
                .normalize('NFKC')
                .toLowerCase()
                .replaceAll(/[^\p{L}\p{N}]/gu, ''),
        )
        .filter((key) => key.length >= MIN_LOOSE_KEY)
        .map((key) => `~${key}`);
    return [...new Set([...titles.map(normalizeTitle).filter((key) => key !== ''), ...loose])];
};

const keysMatch = (a: string, b: string) => {
    if (a === b) {
        return true;
    }
    const [short, long] = a.length < b.length ? [a, b] : [b, a];
    return short.startsWith('~') && long.startsWith(short) && JUNK_SUFFIX.test(long.slice(short.length));
};

const isSameSeries = (a: RecMedia, b: RecMedia) =>
    (a.id > 0 && a.id === b.id) || titleKeys(a).some((key) => titleKeys(b).some((other) => keysMatch(key, other)));

/**
 * Comick's recommendations that the other sources don't already have (brief #15), by votes: each series once, matched
 * by AniList id (list titles lend theirs), then by title, and never the series itself. When Comick has the same series
 * twice, the entry linked to AniList wins (at the better-voted place), so the hide rules and AniList's score apply to it
 * (brief #21 follow-up: an unlinked twin showed as a "CK" card).
 */
export const getComickExtras = (
    recommendations: ComickRecommendation[],
    { shown, seedId, index }: { shown: Pick<RecMedia, 'id' | 'title'>[]; seedId: number; index: ListTitleIndex | null },
): RecMedia[] => {
    const ids = new Set([seedId, ...shown.map(({ id }) => id)]);
    const shownKeys = shown.flatMap(titleKeys);
    const cards = adoptListIds(
        [...recommendations].sort((a, b) => b.votes - a.votes).map(({ media }) => media),
        index,
    );
    const kept: RecMedia[] = [];
    cards.forEach((media) => {
        if (ids.has(media.id) || titleKeys(media).some((key) => shownKeys.some((other) => keysMatch(key, other)))) {
            return;
        }
        const twin = kept.findIndex((other) => isSameSeries(other, media));
        if (twin === -1) {
            kept.push(media);
        } else if (kept[twin].id < 0 && media.id > 0) {
            kept[twin] = media;
        }
    });
    return kept;
};
