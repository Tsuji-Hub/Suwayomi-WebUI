/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { BakaTag, BakaTagRef } from '@/features/tsuji/tags/baka.ts';
import { BAKA_FAMILIES } from '@/features/tsuji/tags/baka.ts';

/*
 * Universal tag search (brief #8 v2, MangaBaka since brief #9): one search box over AniList genres / tags and
 * MangaBaka tags. The user never picks a source: names that mean the same thing become one chip backed by both.
 * Concepts MangaBaka splits across unrelated tags ("System" = System + Level System + System Administrator) are
 * families (BAKA_FAMILIES): one chip, OR inside (brief #11).
 */

/**
 * "Dungeons" -> "dungeon", "Martial Arts" -> "martial art", "Isekai!" -> "isekai": lowercase, punctuation dropped,
 * a trailing plural s dropped.
 */
export const normalizeTagKey = (name: string): string => {
    const words = name
        .toLowerCase()
        .replaceAll(/[^\p{L}\p{N}]+/gu, ' ')
        .trim()
        .split(/\s+/)
        .filter(Boolean);
    const last = words.at(-1);
    if (last && last.length > 3 && last.endsWith('s') && !last.endsWith('ss')) {
        words[words.length - 1] = last.slice(0, -1);
    }
    return words.join(' ');
};

export type TagSuggestion = {
    key: string;
    label: string;
    /** AniList backing (genre or tag name), if any. */
    genre?: string;
    tag?: string;
    /** MangaBaka backing, if any; several = OR (a family). */
    bakaTags?: BakaTagRef[];
    /** A family from BAKA_FAMILIES (offered first). */
    isFamily?: boolean;
    /** A single MangaBaka tag whose name is also a family's ("System" only, without Level System ...). */
    isTagOnly?: boolean;
    /** Size hint: series with the MangaBaka tag(s) (AniList gives no counts; a family adds its members up). */
    count?: number;
    /** MangaBaka parent path ("Settings > Game Elements > System"). */
    path?: string | null;
    isAdult?: boolean;
};

const matchesQuery = (name: string, query: string) => name.toLowerCase().includes(query);

/**
 * Suggestions for a query: families whose name or members contain it (first), AniList genres and tags containing
 * it, and MangaBaka tags containing it (adult ones only with the Adult filter); merged by normalized name, AniList
 * and MangaBaka backing kept side by side. A single tag named like a family stays offered on its own.
 */
export const buildSuggestions = ({
    query,
    genres,
    tags,
    bakaTags,
    showAdult,
    families = BAKA_FAMILIES,
}: {
    query: string;
    genres: string[];
    tags: { name: string; isAdult?: boolean | null }[];
    bakaTags: BakaTag[];
    showAdult: boolean;
    families?: typeof BAKA_FAMILIES;
}): TagSuggestion[] => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) {
        return [];
    }
    const byKey = new Map<string, TagSuggestion>();
    const get = (key: string, label: string) => {
        const existing = byKey.get(key);
        if (existing) {
            return existing;
        }
        const created: TagSuggestion = { key, label };
        byKey.set(key, created);
        return created;
    };
    const familyKeys = new Set(families.map(({ key }) => key));
    const countById = new Map(bakaTags.map(({ id, count }) => [id, count]));

    families
        .filter(({ key, label, tags: members }) =>
            [key, label, ...members.map(({ name }) => name)].some((name) => matchesQuery(name, wanted)),
        )
        .forEach(({ key, label, tags: members }) => {
            const chip = get(key, label);
            chip.bakaTags = members;
            chip.isFamily = true;
            const counts = members.map(({ id }) => countById.get(id)).filter((count) => count !== undefined);
            chip.count = counts.length ? counts.reduce((sum, count) => sum + count, 0) : undefined;
        });

    genres
        .filter((genre) => (showAdult || genre !== 'Hentai') && matchesQuery(genre, wanted))
        .forEach((genre) => {
            get(normalizeTagKey(genre), genre).genre = genre;
        });
    tags.filter(({ name, isAdult }) => (showAdult || !isAdult) && matchesQuery(name, wanted)).forEach(({ name }) => {
        const chip = get(normalizeTagKey(name), name);
        if (!chip.genre) {
            chip.tag = name;
        }
    });

    bakaTags
        .filter(({ name, count, isAdult }) => count > 0 && (showAdult || !isAdult) && matchesQuery(name, wanted))
        .forEach(({ id, name, count, path }) => {
            const nameKey = normalizeTagKey(name);
            const isTagOnly = familyKeys.has(nameKey);
            const chip = get(isTagOnly ? `${nameKey}:tag-${id}` : nameKey, name);
            // Same name twice in MangaBaka's tree: the bigger tag backs the chip.
            if (!chip.bakaTags || count > (chip.count ?? 0)) {
                chip.bakaTags = [{ id, name }];
                chip.count = count;
                chip.path = path;
                chip.isTagOnly = isTagOnly || undefined;
            }
        });

    const rank = (chip: TagSuggestion) => {
        if (chip.isFamily) {
            return 0;
        }
        return chip.label.toLowerCase().startsWith(wanted) ? 1 : 2;
    };
    return [...byKey.values()].sort(
        (a, b) => rank(a) - rank(b) || (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label),
    );
};

/** "Level System (+4)": a member and how many subtags it covers. */
const describeTag = ({ name, subtags }: BakaTagRef) => (subtags ? `${name} (+${subtags})` : name);

/**
 * Hover text: the MangaBaka tags the chip searches (any of them; a single tag by its parent path) and its AniList
 * backing ("System, Level System (+4), System Administrator").
 */
export const describeChip = (chip: Pick<TagSuggestion, 'genre' | 'tag' | 'bakaTags' | 'path'>): string => {
    const members = chip.bakaTags ?? [];
    const bakaPart = members.length > 1 ? members.map(describeTag).join(', ') : null;
    const parts = [
        bakaPart,
        members.length === 1 ? `MangaBaka ${chip.path ?? describeTag(members[0])}` : null,
        chip.genre ? `AniList genre ${chip.genre}` : null,
        chip.tag ? `AniList tag ${chip.tag}` : null,
    ].filter(Boolean);
    return parts.join('; ');
};
