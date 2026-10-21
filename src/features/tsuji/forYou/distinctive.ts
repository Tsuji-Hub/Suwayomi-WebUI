/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import { getContentTags } from '@/features/tsuji/recs/media.ts';
import type { TagStat } from '@/features/tsuji/forYou/tasteProfile.ts';
import { PROFILE_TAG_COUNT } from '@/features/tsuji/forYou/tasteProfile.ts';
import snapshot from '@/features/tsuji/forYou/tagBaseline.json';

/*
 * Distinctive tags (brief #14): a tag almost every manhwa carries (Male Protagonist, 57 % of liked titles vs 48 %
 * of everything) says little about taste; one the user reads five times as often as usual (Medicine) says a lot.
 * weight = total x clamp(lift, 0.5, 3), lift = liked share / baseline share. The baseline is the tag's share of
 * the week's merged candidate pool (200+ titles), else the committed snapshot (AniList's 500 most popular KR / CN
 * titles, tools/scripts/tsuji/build-tag-baseline.mjs), else no lift.
 */

export const LIFT_MIN = 0.5;
export const LIFT_MAX = 3;
/** Fewer titles than this make too noisy a baseline. */
export const MIN_BASELINE_TITLES = 200;
/** Tags kept in the stored taste weights (Discover's Best match, the family row). */
export const TASTE_WEIGHT_COUNT = 60;
/** A tag the baseline never saw counts as this many titles (so its lift is large, not infinite). */
const UNSEEN_TAG_TITLES = 0.5;

/** How many titles of a pool carry each content tag. */
export type TagBaseline = { titles: number; counts: Record<string, number> };

/** Taste weights by tag name, strongest = 1. */
export type TasteWeights = Record<string, number>;

export const SNAPSHOT_BASELINE: TagBaseline = { titles: snapshot.titles, counts: snapshot.counts };

/** Tag shares of a pool of titles (each title once). */
export const buildTagBaseline = (pool: Pick<RecMedia, 'id' | 'tags'>[]): TagBaseline => {
    const seen = new Set<number>();
    const counts: Record<string, number> = {};
    pool.forEach((media) => {
        if (seen.has(media.id)) {
            return;
        }
        seen.add(media.id);
        new Set(getContentTags(media).map(({ name }) => name)).forEach((name) => {
            counts[name] = (counts[name] ?? 0) + 1;
        });
    });
    return { titles: seen.size, counts };
};

/** The first baseline large enough to trust, else null (no lift). */
export const pickBaseline = (...baselines: (TagBaseline | null | undefined)[]): TagBaseline | null =>
    baselines.find((baseline) => !!baseline && baseline.titles >= MIN_BASELINE_TITLES) ?? null;

export const clampLift = (lift: number): number => Math.min(LIFT_MAX, Math.max(LIFT_MIN, lift));

/** Liked share / baseline share, clamped to 0.5..3. */
export const getLift = (stat: Pick<TagStat, 'name' | 'titles'>, likedCount: number, baseline: TagBaseline): number => {
    const likedShare = stat.titles / Math.max(1, likedCount);
    const baselineShare = Math.max(UNSEEN_TAG_TITLES, baseline.counts[stat.name] ?? 0) / baseline.titles;
    return clampLift(likedShare / baselineShare);
};

/** Liked tags by distinctive weight (total x lift; total alone without a baseline), strongest first. */
export const getDistinctiveTags = (
    stats: TagStat[],
    likedCount: number,
    baseline: TagBaseline | null,
): { name: string; weight: number }[] =>
    stats
        .map((stat) => ({
            name: stat.name,
            weight: stat.total * (baseline ? getLift(stat, likedCount, baseline) : 1),
        }))
        .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));

/** The ranker's seed-tag shape: the strongest PROFILE_TAG_COUNT, rank 1-100 relative to the strongest. */
export const toProfileTags = (tags: { name: string; weight: number }[]): RecTag[] => {
    const kept = tags.filter(({ weight }) => weight > 0).slice(0, PROFILE_TAG_COUNT);
    const strongest = kept[0]?.weight || 1;
    return kept.map(({ name, weight }) => ({ name, rank: Math.max(1, Math.round((100 * weight) / strongest)) }));
};

/** The strongest TASTE_WEIGHT_COUNT tags, strongest = 1 (small enough to keep for a month). */
export const toTasteWeights = (tags: { name: string; weight: number }[]): TasteWeights => {
    const kept = tags.filter(({ weight }) => weight > 0).slice(0, TASTE_WEIGHT_COUNT);
    const strongest = kept[0]?.weight || 1;
    return Object.fromEntries(kept.map(({ name, weight }) => [name, Math.round((1000 * weight) / strongest) / 1000]));
};

/** How well a title fits the taste: the sum of weight x rank/100 over its content tags (not normalized). */
export const getTasteAffinity = (media: Pick<RecMedia, 'tags'>, weights: TasteWeights): number =>
    getContentTags(media).reduce((sum, tag) => sum + (weights[tag.name] ?? 0) * (Math.max(0, tag.rank ?? 0) / 100), 0);
