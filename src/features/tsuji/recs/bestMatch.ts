/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { isSpoilerTag } from '@/features/tsuji/recs/media.ts';
import type { TasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { getTasteAffinity } from '@/features/tsuji/forYou/distinctive.ts';

/*
 * Discover's Best match (brief #14): how well a card fits the picked chips, and how well it fits the user's taste.
 * score = 0.6 x chip fit + 0.4 x taste affinity (affinity normalized 0..1 per page); without taste weights (no
 * For You profile cached; Discover never fetches one) the score is the chip fit alone. Ties keep the feed's order
 * of popularity. Each page is ranked on its own: pages append, never reshuffle.
 */

export const WEIGHT_FIT = 0.6;
export const WEIGHT_TASTE = 0.4;

/** The included chips of a search, as the fit scores them. */
export type FitChips = {
    /**
     * Chips every card matches by how it was found: MangaBaka sub-searches AND one tag of every chip (a family
     * through any member), AniList's genre search ANDs its genres.
     */
    matched: number;
    /** AniList tag chips: the card's tag rank / 100 (0 without the tag). */
    tags: string[];
    /** AniList genre chips checked on the card (MangaBaka cards' AniList details). */
    genres: string[];
};

export const NO_FIT_CHIPS: FitChips = { matched: 0, tags: [], genres: [] };

export const countFitChips = ({ matched, tags, genres }: FitChips) => matched + tags.length + genres.length;

/** Share of the included chips the card matches, 0..1 (0 without included chips). */
export const getChipFit = (media: Pick<RecMedia, 'tags' | 'genres'>, chips: FitChips): number => {
    const total = countFitChips(chips);
    if (!total) {
        return 0;
    }
    const rankByName = new Map(
        (media.tags ?? []).filter((tag) => !isSpoilerTag(tag)).map((tag) => [tag.name, tag.rank ?? 0]),
    );
    const genres = new Set(media.genres ?? []);
    const tagFit = chips.tags.reduce((sum, name) => sum + Math.max(0, rankByName.get(name) ?? 0) / 100, 0);
    const genreFit = chips.genres.filter((name) => genres.has(name)).length;
    return (chips.matched + tagFit + genreFit) / total;
};

/**
 * One page by Best match, best first. Ties: AniList popularity (`'popularity'`), or the order the page came in
 * (`'order'`: MangaBaka pages, already by MangaBaka's popularity rank).
 */
export const rankBestMatch = <T extends Pick<RecMedia, 'tags' | 'genres' | 'popularity'>>(
    page: T[],
    chips: FitChips,
    weights: TasteWeights | null,
    ties: 'popularity' | 'order' = 'popularity',
): T[] => {
    const affinities = page.map((media) => (weights ? getTasteAffinity(media, weights) : 0));
    const strongest = Math.max(0, ...affinities);
    const scored = page.map((media, index) => {
        const fit = getChipFit(media, chips);
        const score = weights ? WEIGHT_FIT * fit + WEIGHT_TASTE * (strongest ? affinities[index] / strongest : 0) : fit;
        return { media, index, score };
    });
    return scored
        .sort(
            (a, b) =>
                b.score - a.score ||
                (ties === 'popularity' ? (b.media.popularity ?? 0) - (a.media.popularity ?? 0) : 0) ||
                a.index - b.index,
        )
        .map(({ media }) => media);
};
