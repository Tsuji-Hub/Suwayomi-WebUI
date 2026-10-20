/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ComicType, RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { TagFilterState } from '@/features/tsuji/recs/filters.ts';

/*
 * MangaBaka (brief #9): the tag search engine for chips AniList doesn't have ("System"). Its series carry their
 * AniList id, so cards render straight from it and key on that id; nothing is matched by title.
 * Verified live (2026-10-20, brief #11): tags are searched by ID only. An id covers the tag's whole subtree (a name
 * covers only the tag itself, "System" by name is even a substring match), and a name mixed with an id returns
 * nothing. Repeated `tag=` is AND, repeated `type=` is OR, `tag_not=<id>` excludes the subtree too, the default
 * content rating is safe + suggestive, `popularity_asc` is most popular first (popularity is a rank).
 */

/** One MangaBaka tag behind a chip; `subtags` only for the hover text ("Level System (+4)"). */
export type BakaTagRef = { id: number; name: string; subtags?: number };

/**
 * A chip of the universal tag search with MangaBaka tags behind it (the AniList name too when merged). Several
 * tags = OR inside the chip (a family like System, or tags the user added with "+ also match").
 */
export type BakaChip = {
    state: TagFilterState;
    label: string;
    bakaTags: BakaTagRef[];
    /** MangaBaka parent path of a single tag, for the hover text. */
    path?: string | null;
    genre?: string;
    tag?: string;
    /** Tags added with "+ also match" (shown as "System +2"). */
    alsoMatch?: number;
};

/** The chip's MangaBaka tags (selections saved before brief #11 carried one `bakaTag`). */
export const getChipTags = (chip: { bakaTags?: BakaTagRef[]; bakaTag?: BakaTagRef }): BakaTagRef[] =>
    chip.bakaTags ?? (chip.bakaTag ? [chip.bakaTag] : []);

/**
 * Concepts MangaBaka splits across tags with no shared parent: one chip searches them all (OR). Ids verified live
 * (2026-10-20). Age Regression (748) is something else and stays out of Regression.
 */
export const BAKA_FAMILIES: { key: string; label: string; tags: BakaTagRef[] }[] = [
    {
        key: 'system',
        label: 'System',
        tags: [
            { id: 3081, name: 'System' },
            { id: 1171, name: 'Level System', subtags: 4 },
            { id: 1196, name: 'System Administrator' },
        ],
    },
    {
        key: 'regression',
        label: 'Regression',
        tags: [
            { id: 3495, name: 'Regressor Protagonist' },
            { id: 2461, name: 'Regressed Male Lead' },
            { id: 2147, name: 'Regressed Female Lead' },
            { id: 5101, name: 'Multiple Regressed Individuals' },
        ],
    },
    {
        key: 'dungeon',
        label: 'Dungeon',
        tags: [
            { id: 500, name: 'Dungeon' },
            { id: 2103, name: 'Dungeon Exploring' },
        ],
    },
];

/** Selected MangaBaka-backed chips, by tag key. */
export type BakaSelection = Record<string, BakaChip>;

/** AniList-only genre / tag chips of a selection. */
export type AniListChips = { genres: Record<string, TagFilterState>; tags: Record<string, TagFilterState> };

export const hasAniListBacking = (chip: Pick<BakaChip, 'genre' | 'tag'>) => !!chip.genre || !!chip.tag;

/** AniList unless a selected chip has nothing on AniList; then MangaBaka (AniList-only searches never call it). */
export const getSearchEngine = (baka: BakaSelection | undefined): 'anilist' | 'baka' =>
    Object.values(baka ?? {}).some((chip) => !hasAniListBacking(chip)) ? 'baka' : 'anilist';

/** AniList names of the merged chips in a state (an AniList search uses them like picked AniList chips). */
export const getAniListNames = (baka: BakaSelection | undefined, state: TagFilterState) => {
    const chips = Object.values(baka ?? {}).filter((chip) => chip.state === state);
    return {
        genres: chips.map(({ genre }) => genre).filter((name): name is string => !!name),
        tags: chips.map(({ tag }) => tag).filter((name): name is string => !!name),
    };
};

export type BakaTag = {
    id: number;
    name: string;
    /** "Settings > Game Elements > System". */
    path: string | null;
    count: number;
    isAdult: boolean;
    isGenre: boolean;
};

const ADULT_RATINGS = new Set(['erotica', 'pornographic']);
export const SAFE_RATINGS = ['safe', 'suggestive'];
export const ALL_RATINGS = ['safe', 'suggestive', 'erotica', 'pornographic'];

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const asNumber = (value: unknown): number | null => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
};
const asString = (value: unknown): string | null => (typeof value === 'string' && value ? value : null);

/** `/v1/tags?q=` rows; malformed rows are skipped. */
export const parseBakaTags = (json: unknown): BakaTag[] => {
    const { data } = asRecord(json);
    return (Array.isArray(data) ? data : []).flatMap((row) => {
        const tag = asRecord(row);
        const id = asNumber(tag.id);
        const name = asString(tag.name);
        if (id === null || !name) {
            return [];
        }
        return [
            {
                id,
                name,
                path: asString(tag.name_path),
                count: asNumber(tag.series_count) ?? 0,
                isAdult: ADULT_RATINGS.has(String(tag.content_rating ?? '')),
                isGenre: tag.is_genre === true,
            },
        ];
    });
};

/** What a card needs from a MangaBaka series (kept small: search pages are cached an hour). */
export type BakaSeries = {
    id: number;
    anilistId: number | null;
    malId: number | null;
    title: string;
    english: string | null;
    romaji: string | null;
    cover: string | null;
    type: string | null;
    status: string | null;
    rating: number | null;
    /** Global popularity rank (1 = most popular). */
    popularity: number | null;
    totalChapters: number | null;
    isAdult: boolean;
    year: number | null;
};

const TITLE_LANGUAGES = ['en', 'ja-Latn', 'ko-Latn', 'zh-Latn', 'ja', 'ko', 'zh'];

type BakaTitle = { language?: string; title?: string; is_primary?: boolean; traits?: string[] };

const rankTitle = (title: BakaTitle) => {
    if (title.is_primary) {
        return 0;
    }
    return title.traits?.includes('official') ? 1 : 2;
};

/** Best title per language (primary, then official), as upstream Mihon picks it. */
const pickTitle = (titles: BakaTitle[], language: string): string | null => {
    const [best] = titles
        .filter((title) => title.language === language && title.title)
        .sort((a, b) => rankTitle(a) - rankTitle(b));
    return best?.title ?? null;
};

const sourceId = (source: Record<string, unknown>, key: string) => asNumber(asRecord(source[key]).id);

const parseCover = (cover: unknown): string | null => {
    if (typeof cover === 'string') {
        return cover || null;
    }
    const record = asRecord(cover);
    return (
        asString(asRecord(record.x250).x1) ??
        asString(asRecord(record.x350).x1) ??
        asString(asRecord(record.raw).url) ??
        asString(record.url)
    );
};

export const parseBakaSeries = (row: unknown): BakaSeries | null => {
    const series = asRecord(row);
    const id = asNumber(series.id);
    if (id === null) {
        return null;
    }
    const titles = Array.isArray(series.titles) ? (series.titles as BakaTitle[]) : [];
    const english = pickTitle(titles, 'en') ?? asString(series.title);
    const romaji =
        pickTitle(titles, 'ja-Latn') ??
        pickTitle(titles, 'ko-Latn') ??
        pickTitle(titles, 'zh-Latn') ??
        asString(series.romanized_title);
    const title =
        asString(series.title) ??
        TITLE_LANGUAGES.map((language) => pickTitle(titles, language)).find(Boolean) ??
        titles.find(({ title: name }) => !!name)?.title ??
        `MangaBaka ${id}`;
    const source = asRecord(series.source);
    const published = asRecord(series.published);
    return {
        id,
        anilistId: sourceId(source, 'anilist'),
        malId: sourceId(source, 'my_anime_list'),
        title,
        english,
        romaji,
        cover: parseCover(series.cover),
        type: asString(series.type),
        status: asString(series.status),
        rating: asNumber(series.rating),
        popularity: asNumber(series.popularity) ?? asNumber(asRecord(asRecord(series.popularity).global).current),
        totalChapters: asNumber(series.total_chapters),
        isAdult: ADULT_RATINGS.has(String(series.content_rating ?? '')),
        year: asNumber(series.year) ?? asNumber(String(published.start_date ?? '').slice(0, 4)),
    };
};

/** `/v1/series/search` page: series in order, and whether another page exists. */
export const parseBakaSearch = (json: unknown, limit: number): { series: BakaSeries[]; hasNextPage: boolean } => {
    const record = asRecord(json);
    const data = Array.isArray(record.data) ? record.data : [];
    const pagination = asRecord(record.pagination);
    const series = data.map(parseBakaSeries).filter((each): each is BakaSeries => !!each);
    const hasNext = 'next' in pagination ? !!pagination.next : data.length >= limit;
    return { series, hasNextPage: hasNext };
};

const BAKA_TYPES: Record<ComicType, string> = { MANHWA: 'manhwa', MANHUA: 'manhua', MANGA: 'manga' };
const COUNTRY_BY_BAKA_TYPE: Record<string, string> = { manhwa: 'KR', manhua: 'CN', manga: 'JP' };

export type BakaSort = 'popularity_asc' | 'score_desc' | 'published_year_desc';

/**
 * Discover's sorts on MangaBaka. Popularity is a rank, so `popularity_asc` is the most popular first; Best match
 * has no relevance without a text query and uses it too. `score_desc` is MangaBaka's vote-weighted score.
 */
export const getBakaSort = (sort: string): BakaSort => {
    switch (sort) {
        case 'SCORE':
            return 'score_desc';
        case 'NEWEST':
            return 'published_year_desc';
        default:
            return 'popularity_asc';
    }
};

/** Most sub-searches one selection runs (the product of the chips' tag sets). */
export const MAX_BAKA_COMBINATIONS = 16;

/**
 * The tag ids of each sub-search: one id from every included chip (AND across chips, OR inside a chip), as the
 * cartesian product of the chips' id sets, capped at MAX_BAKA_COMBINATIONS. No included chip = one search.
 */
export const getBakaCombinations = (includeSets: number[][]): number[][] =>
    includeSets
        .filter((ids) => ids.length)
        .reduce<number[][]>((combos, ids) => combos.flatMap((combo) => ids.map((id) => [...combo, id])), [[]])
        .map((combo) => [...new Set(combo)].sort((a, b) => a - b))
        .filter((combo, index, list) => list.findIndex((other) => other.join() === combo.join()) === index)
        .slice(0, MAX_BAKA_COMBINATIONS);

/**
 * One page of one sub-search: tag ids only (AND), excluded tag ids, types from the Type filter (comics only without
 * one), the minimum score server side, adult ratings only with the Adult filter on. The minimum chapter count stays
 * client side: MangaBaka drops series without a count, Discover lets them pass.
 */
export const buildBakaSearch = ({
    tagIds,
    excludeIds,
    types,
    sort,
    minScore,
    showAdult,
    page,
    limit,
}: {
    tagIds: number[];
    excludeIds: number[];
    types: ComicType[];
    sort: string;
    minScore: number;
    showAdult: boolean;
    page: number;
    limit: number;
}): string => {
    const params = new URLSearchParams();
    [...new Set(tagIds)].sort((a, b) => a - b).forEach((id) => params.append('tag', String(id)));
    [...new Set(excludeIds)].sort((a, b) => a - b).forEach((id) => params.append('tag_not', String(id)));
    (types.length ? types : (Object.keys(BAKA_TYPES) as ComicType[]))
        .map((type) => BAKA_TYPES[type])
        .sort()
        .forEach((type) => params.append('type', type));
    (showAdult ? ALL_RATINGS : SAFE_RATINGS).forEach((rating) => params.append('content_rating', rating));
    if (minScore > 0) {
        params.set('rating_lower', String(minScore));
    }
    params.set('sort_by', getBakaSort(sort));
    params.set('page', String(page));
    params.set('limit', String(limit));
    return params.toString();
};

const nullsLast = (value: number | null, direction: 1 | -1) =>
    value === null ? Number.POSITIVE_INFINITY : value * direction;

/**
 * The order the sub-searches are merged in, matching each one's `sort_by`: popularity rank ascending, score and
 * year descending; unknown values last, then MangaBaka id.
 */
export const compareBakaSeries = (sort: string) => {
    const key = (series: BakaSeries): number => {
        switch (getBakaSort(sort)) {
            case 'score_desc':
                return nullsLast(series.rating, -1);
            case 'published_year_desc':
                return nullsLast(series.year, -1);
            default:
                return nullsLast(series.popularity, 1);
        }
    };
    return (a: BakaSeries, b: BakaSeries) => key(a) - key(b) || a.id - b.id;
};

const STATUS_BY_BAKA: Record<string, string> = {
    releasing: 'RELEASING',
    completed: 'FINISHED',
    hiatus: 'HIATUS',
    cancelled: 'CANCELLED',
    upcoming: 'NOT_YET_RELEASED',
};

/**
 * A MangaBaka series as a card: the AniList id when it has one (list state, marks, badges and library hiding key
 * on it), else a negative id (no list state, Find to read by title). MangaBaka's chapter count and rating stay on
 * the card even after AniList details land, so filters never flip a card that was shown.
 */
export const toBakaMedia = (series: BakaSeries, details?: RecMedia | null): RecMedia => {
    const base: RecMedia = {
        id: series.anilistId ?? -series.id,
        idMal: series.malId,
        siteUrl: `https://mangabaka.org/${series.id}`,
        title: { userPreferred: series.title, english: series.english, romaji: series.romaji },
        coverImage: { large: series.cover },
        description: null,
        averageScore: series.rating !== null ? Math.round(series.rating) : null,
        meanScore: null,
        popularity: null,
        favourites: null,
        countryOfOrigin: COUNTRY_BY_BAKA_TYPE[series.type ?? ''] ?? null,
        format: series.type === 'novel' ? 'NOVEL' : 'MANGA',
        status: STATUS_BY_BAKA[series.status ?? ''] ?? null,
        chapters: series.totalChapters,
        isAdult: series.isAdult,
        startDate: series.year ? { year: series.year, month: null, day: null } : null,
        tags: [],
    };
    if (!details || series.anilistId === null) {
        return base;
    }
    return {
        ...details,
        title: details.title ?? base.title,
        coverImage: base.coverImage?.large ? base.coverImage : details.coverImage,
        averageScore: base.averageScore ?? details.averageScore,
        chapters: base.chapters ?? details.chapters,
        countryOfOrigin: base.countryOfOrigin ?? details.countryOfOrigin,
        isAdult: base.isAdult || !!details.isAdult,
    };
};

/** No AniList entry behind the card (negative id): no list state, comments or reviews. */
export const isUnmatchedMedia = (media: Pick<RecMedia, 'id'>) => media.id < 0;

/** AniList-only chips applied to the AniList details of a card (tags need rank >= 60; genres as they are). */
export const passesAniListChips = (media: RecMedia | null, { genres, tags }: AniListChips): boolean => {
    const genreStates = Object.entries(genres);
    const tagStates = Object.entries(tags);
    if (!genreStates.length && !tagStates.length) {
        return true;
    }
    const hasIncluded = [...genreStates, ...tagStates].some(([, state]) => state === 'include');
    if (!media) {
        // A card without AniList details can't be checked: it drops out only when it would have to have something.
        return !hasIncluded;
    }
    const mediaGenres = new Set(media.genres ?? []);
    const strongTags = new Set((media.tags ?? []).filter(({ rank }) => (rank ?? 0) >= 60).map(({ name }) => name));
    const anyTags = new Set((media.tags ?? []).map(({ name }) => name));
    return (
        genreStates.every(([name, state]) => (state === 'include') === mediaGenres.has(name)) &&
        tagStates.every(([name, state]) => (state === 'include' ? strongTags.has(name) : !anyTags.has(name)))
    );
};

/**
 * Cards for MangaBaka pages while AniList details land: a card shows at once from MangaBaka; the AniList
 * post-filter applies once its details are in (`null` = AniList had nothing, as for series without an AniList id).
 * One card per id.
 */
export const toBakaCards = (
    pages: BakaSeries[][],
    details: ReadonlyMap<number, RecMedia | null>,
    postFilter: AniListChips,
): RecMedia[][] => {
    const hasPostFilter = !!Object.keys(postFilter.genres).length || !!Object.keys(postFilter.tags).length;
    const shown = new Set<number>();
    return pages.map((page) =>
        page.flatMap((series) => {
            const isKnown = series.anilistId === null || details.has(series.anilistId);
            const detail = series.anilistId === null ? null : (details.get(series.anilistId) ?? null);
            if (hasPostFilter && isKnown && !passesAniListChips(detail, postFilter)) {
                return [];
            }
            const media = toBakaMedia(series, detail);
            if (shown.has(media.id)) {
                return [];
            }
            shown.add(media.id);
            return [media];
        }),
    );
};

/** The AniList ids of a page still without details. */
export const getMissingDetails = (series: BakaSeries[], details: ReadonlyMap<number, RecMedia | null>): number[] => [
    ...new Set(series.map(({ anilistId }) => anilistId).filter((id): id is number => id !== null && !details.has(id))),
];
