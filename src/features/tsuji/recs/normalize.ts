/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Title key for exact matching (AniList id resolution, "hide in library"). Mirrors Makimono's normalizeTitle:
 * lowercase, drop bracketed spans, keep [a-z0-9 ] only. Non-latin titles become "" and never match.
 */
export const normalizeTitle = (title: string | null | undefined): string =>
    (title ?? '')
        .normalize('NFKD')
        .replaceAll(/\p{M}/gu, '')
        .toLowerCase()
        .replaceAll(/\[[^\]]*\]|\([^)]*\)|\{[^}]*\}|<[^>]*>/g, ' ')
        .replaceAll(/[^a-z0-9 ]/g, ' ')
        .replaceAll(/\s+/g, ' ')
        .trim();

export const titlesMatch = (a: string | null | undefined, b: string | null | undefined): boolean => {
    const normalizedA = normalizeTitle(a);

    return normalizedA !== '' && normalizedA === normalizeTitle(b);
};

export const findExactTitleMatch = (
    target: string,
    candidates: { id: number; titles: (string | null | undefined)[] }[],
): number | null => candidates.find(({ titles }) => titles.some((title) => titlesMatch(target, title)))?.id ?? null;
