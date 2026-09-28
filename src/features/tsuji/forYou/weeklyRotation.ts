/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import type { SeedCandidate } from '@/features/tsuji/forYou/tasteProfile.ts';

/*
 * Weekly rotation: everything that varies from week to week is drawn from a random generator seeded with the
 * AniList user + ISO week, so For You is stable within a week, the same on every device, and new every Monday.
 */

export const SEEDS_PER_WEEK = 4;
/** Always-on core: the profile's strongest tags. */
export const CORE_TAG_COUNT = 3;
/** Rotating tags drawn from the next strongest ones. */
export const ROTATING_TAG_COUNT = 3;
export const ROTATING_TAG_WINDOW = 12;
/** Titles in last week's top picks start this much lower, so the head changes even when the seeds overlap. */
export const LAST_WEEK_DEMOTION = 0.85;

/** ISO 8601 week in local time, e.g. "2026-W39" (weeks start on Monday). */
export const getIsoWeekKey = (date: Date): string => {
    const day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    const weekday = (day.getDay() + 6) % 7; // Monday = 0
    day.setDate(day.getDate() - weekday + 3); // Thursday decides the ISO year
    const isoYear = day.getFullYear();
    const firstThursday = new Date(isoYear, 0, 4);
    firstThursday.setDate(firstThursday.getDate() - ((firstThursday.getDay() + 6) % 7) + 3);
    const week = 1 + Math.round((day.getTime() - firstThursday.getTime()) / (7 * 24 * 60 * 60 * 1000));
    return `${isoYear}-W${String(week).padStart(2, '0')}`;
};

/** Local midnight of this week's Monday and of the next one. */
export const getWeekBounds = (date: Date): { start: Date; end: Date } => {
    const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return { start, end };
};

/** FNV-1a 32-bit. */
export const hashString = (value: string): number => {
    let hash = 0x811c9dc5;
    for (let index = 0; index < value.length; index += 1) {
        hash ^= value.charCodeAt(index);
        hash = Math.imul(hash, 0x01000193);
    }
    return hash >>> 0;
};

/** mulberry32: small, fast, good enough to pick seeds; returns floats in [0, 1). */
export const createRandom = (seed: number): (() => number) => {
    let state = seed >>> 0;
    return () => {
        state = (state + 0x6d2b79f5) >>> 0;
        let t = state;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
    };
};

export const createWeeklyRandom = (userName: string, weekKey: string) =>
    createRandom(hashString(`${userName.toLowerCase()}|${weekKey}`));

/** Weighted sampling without replacement (weights must be > 0). */
export const sampleWeighted = <T>(items: T[], count: number, weightOf: (item: T) => number, random: () => number) => {
    const pool = items.filter((item) => weightOf(item) > 0);
    const picked: T[] = [];

    while (picked.length < count && pool.length) {
        const total = pool.reduce((sum, item) => sum + weightOf(item), 0);
        let target = random() * total;
        const index = pool.findIndex((item) => {
            target -= weightOf(item);
            return target < 0;
        });
        picked.push(...pool.splice(index === -1 ? pool.length - 1 : index, 1));
    }

    return picked;
};

export const pickWeeklySeeds = (pool: SeedCandidate[], random: () => number, count = SEEDS_PER_WEEK) =>
    sampleWeighted(pool, count, ({ weight }) => weight, random);

/** Core tags (strongest, every week) + rotating tags sampled from the next ones, by profile rank. */
export const pickWeeklyTags = (profileTags: RecTag[], random: () => number): { core: string[]; rotating: string[] } => {
    const core = profileTags.slice(0, CORE_TAG_COUNT);
    const window = profileTags.slice(CORE_TAG_COUNT, CORE_TAG_COUNT + ROTATING_TAG_WINDOW);
    const rotating = sampleWeighted(window, ROTATING_TAG_COUNT, ({ rank }) => rank ?? 0, random);

    return { core: core.map(({ name }) => name), rotating: rotating.map(({ name }) => name) };
};
