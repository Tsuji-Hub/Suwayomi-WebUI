/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Universal tag search (brief #8 v2): one search box over AniList genres / tags and MangaUpdates categories. The
 * user never picks a source: names that mean the same thing become one chip backed by both, and a few aliases
 * expand one chip into several MU categories (AniList has no "System", MU has System, Level System, Stat System).
 */

/** MU categories used by fewer series than this are noise (typos, one-off tags). */
export const MU_MIN_USAGE = 20;

/** At most this many MU categories behind one chip (one MU query each). */
export const MAX_CATEGORIES_PER_CHIP = 3;

/**
 * "Dungeon/s" -> "dungeon", "Martial Arts" -> "martial art", "Isekai!" -> "isekai": lowercase, MU's "/s" "/es"
 * "/ies" plural markers and punctuation dropped, a trailing plural s dropped.
 */
export const normalizeTagKey = (name: string): string => {
    const words = name
        .toLowerCase()
        .replaceAll(/\/(?:s|es|ies)\b/g, '')
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

/** One chip expands to these MU categories (ordered: the first gives the size hint). */
export const TAG_ALIASES: Record<string, { label: string; categories: string[] }> = {
    system: { label: 'System', categories: ['System', 'Level System', 'Stat System'] },
    litrpg: { label: 'LitRPG', categories: ['Game Elements', 'Level System'] },
    'game element': { label: 'Game Elements', categories: ['Game Elements', 'Level System'] },
    regression: { label: 'Regression', categories: ['Regression'] },
};

export type TagSuggestion = {
    key: string;
    label: string;
    /** AniList backing (genre or tag name), if any. */
    genre?: string;
    tag?: string;
    /** MU categories behind the chip (empty = AniList only). */
    categories: string[];
    /** Size hint: titles in MU's first category (AniList gives no counts). */
    count?: number;
    isAdult?: boolean;
};

export type MuCategory = { category: string; usage: number };

const matchesQuery = (name: string, query: string) => name.toLowerCase().includes(query);

/**
 * Suggestions for a query: AniList genres and tags containing it, MU categories (usage >= 20) containing it, and
 * aliases whose key or label contains it; then merged by normalized name (aliases win, AniList backing is kept).
 */
export const buildSuggestions = ({
    query,
    genres,
    tags,
    muCategories,
    showAdult,
}: {
    query: string;
    genres: string[];
    tags: { name: string; isAdult?: boolean | null }[];
    muCategories: MuCategory[];
    showAdult: boolean;
}): TagSuggestion[] => {
    const wanted = query.trim().toLowerCase();
    if (!wanted) {
        return [];
    }
    const byKey = new Map<string, TagSuggestion>();
    const usage = new Map(muCategories.map(({ category, usage: count }) => [category, count]));
    const get = (key: string, label: string) => {
        const existing = byKey.get(key);
        if (existing) {
            return existing;
        }
        const created: TagSuggestion = { key, label, categories: [] };
        byKey.set(key, created);
        return created;
    };

    Object.entries(TAG_ALIASES)
        .filter(([key, { label }]) => key.includes(wanted) || matchesQuery(label, wanted))
        .forEach(([key, { label, categories }]) => {
            const chip = get(key, label);
            chip.categories = categories.slice(0, MAX_CATEGORIES_PER_CHIP);
            chip.count = usage.get(categories[0]) ?? chip.count;
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

    muCategories
        .filter(({ category, usage: count }) => count >= MU_MIN_USAGE && matchesQuery(category, wanted))
        .forEach(({ category, usage: count }) => {
            const key = normalizeTagKey(category);
            const isAlias = key in TAG_ALIASES;
            const chip = get(key, category);
            if (!isAlias && !chip.categories.includes(category)) {
                chip.categories = [...chip.categories, category].slice(0, MAX_CATEGORIES_PER_CHIP);
                chip.count = Math.max(chip.count ?? 0, count);
            }
        });

    const startsWith = (chip: TagSuggestion) => (chip.label.toLowerCase().startsWith(wanted) ? 0 : 1);
    return [...byKey.values()].sort(
        (a, b) => startsWith(a) - startsWith(b) || (b.count ?? 0) - (a.count ?? 0) || a.label.localeCompare(b.label),
    );
};

/** Hover text: what the chip searches ("includes: System, Level System, Stat System" / "AniList tag"). */
export const describeChip = (chip: Pick<TagSuggestion, 'genre' | 'tag' | 'categories'>): string => {
    const parts = [
        chip.genre ? `AniList genre ${chip.genre}` : null,
        chip.tag ? `AniList tag ${chip.tag}` : null,
        chip.categories.length ? `MangaUpdates: ${chip.categories.join(', ')}` : null,
    ].filter(Boolean);
    return `includes: ${parts.join('; ')}`;
};
