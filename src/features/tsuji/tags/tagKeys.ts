/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { BakaTag } from '@/features/tsuji/tags/baka.ts';

/*
 * Universal tag search (brief #8 v2, MangaBaka since brief #9): one search box over AniList genres / tags and
 * MangaBaka tags. The user never picks a source: names that mean the same thing become one chip backed by both.
 * MangaBaka's own hierarchy replaces #8's aliases ("System" sits under Game Elements; Level System and Stat System
 * are tags of their own, offered next to it).
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
    /** MangaBaka backing, if any. */
    bakaTag?: { id: number; name: string };
    /** Size hint: series with the MangaBaka tag (AniList gives no counts). */
    count?: number;
    /** MangaBaka parent path ("Settings > Game Elements > System"). */
    path?: string | null;
    isAdult?: boolean;
};

const matchesQuery = (name: string, query: string) => name.toLowerCase().includes(query);

/**
 * Suggestions for a query: AniList genres and tags containing it, and MangaBaka tags containing it (adult ones
 * only with the Adult filter); merged by normalized name, AniList and MangaBaka backing kept side by side.
 */
export const buildSuggestions = ({
    query,
    genres,
    tags,
    bakaTags,
    showAdult,
}: {
    query: string;
    genres: string[];
    tags: { name: string; isAdult?: boolean | null }[];
    bakaTags: BakaTag[];
    showAdult: boolean;
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
            const chip = get(normalizeTagKey(name), name);
            // Same name twice in MangaBaka's tree: the bigger tag backs the chip.
            if (!chip.bakaTag || count > (chip.count ?? 0)) {
                chip.bakaTag = { id, name };
                chip.count = count;
                chip.path = path;
            }
        });

    const startsWith = (chip: TagSuggestion) => (chip.label.toLowerCase().startsWith(wanted) ? 0 : 1);
    return [...byKey.values()].sort(
        (a, b) => startsWith(a) - startsWith(b) || (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label),
    );
};

/** Hover text: MangaBaka's parent path and where the chip searches ("AniList tag Dungeon; MangaBaka"). */
export const describeChip = (chip: Pick<TagSuggestion, 'genre' | 'tag' | 'bakaTag' | 'path'>): string => {
    const parts = [
        chip.genre ? `AniList genre ${chip.genre}` : null,
        chip.tag ? `AniList tag ${chip.tag}` : null,
        chip.bakaTag ? `MangaBaka ${chip.path ?? chip.bakaTag.name}` : null,
    ].filter(Boolean);
    return parts.join('; ');
};
