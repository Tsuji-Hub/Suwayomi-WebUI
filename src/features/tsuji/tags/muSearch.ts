/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { TagFilterState } from '@/features/tsuji/recs/filters.ts';
import type { ComicType, RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';
import { titleSimilarity } from '@/features/tsuji/comments/comick.ts';

/*
 * The MangaUpdates side of the universal tag search. A Discover selection keeps AniList genres / tags as before;
 * chips with MU categories behind them live in `mu`. As soon as one selected chip has no AniList backing, the
 * search runs on MU (v1/series/search through the relay) and the results are matched back to AniList media, so
 * badges, marks, filters, preview and Find to read keep working.
 */

/** A selected chip with MangaUpdates categories behind it (and AniList backing when the names merged). */
export type MuChip = {
    state: TagFilterState;
    label: string;
    categories: string[];
    genre?: string;
    tag?: string;
};

export type MuSelection = Record<string, MuChip>;

/** AniList-only chips of a Discover selection (genre / tag name -> state). */
export type AniListChips = { genres: Record<string, TagFilterState>; tags: Record<string, TagFilterState> };

export const hasAniListBacking = (chip: Pick<MuChip, 'genre' | 'tag'>) => !!chip.genre || !!chip.tag;

/**
 * MU runs the search when a selected chip has nothing on AniList (included: AniList can't search for it;
 * excluded: AniList can't leave it out). Otherwise AniList, exactly as before: no MU call at all.
 */
export const getSearchEngine = (mu: MuSelection | undefined): 'anilist' | 'mu' =>
    Object.values(mu ?? {}).some((chip) => !hasAniListBacking(chip) && chip.categories.length) ? 'mu' : 'anilist';

/** AniList names behind the MU selection's merged chips, for the AniList path (merged chips search both ways). */
export const getAniListNames = (mu: MuSelection | undefined, state: TagFilterState) => {
    const chips = Object.values(mu ?? {}).filter((chip) => chip.state === state);
    return {
        genres: chips.flatMap(({ genre }) => (genre ? [genre] : [])),
        tags: chips.flatMap(({ tag }) => (tag ? [tag] : [])),
    };
};

/**
 * Whether MU combines several values of one array (`category: [a, b]`) as AND. The MU website's advanced search
 * requires every listed category; assumed here and checked live by Cowork (System + Martial Arts must narrow).
 */
export const MU_CATEGORY_ARRAY_IS_AND = true;

/** Upper bound on MU queries per page (categories inside a chip are OR: one query per combination). */
export const MAX_MU_QUERIES = 6;

const MU_TYPES: Record<ComicType, string> = { MANHWA: 'Manhwa', MANHUA: 'Manhua', MANGA: 'Manga' };
export const ADULT_MU_GENRES = ['Adult', 'Hentai', 'Smut'];

export type MuOrderBy = 'rating' | 'year';

/** Discover sort -> MU orderby (MU has no popularity order; the cards are re-ranked client side anyway). */
export const getMuOrderBy = (sort: string): MuOrderBy => (sort === 'NEWEST' ? 'year' : 'rating');

const cartesian = (lists: string[][]): string[][] =>
    lists.reduce<string[][]>((combos, list) => combos.flatMap((combo) => list.map((item) => [...combo, item])), [[]]);

/**
 * MangaUpdates' fixed genre list. An AniList genre / tag with one of these names is sent to MU as `genre` /
 * `exclude_genre` (server side) instead of filtering the matched results afterwards.
 */
export const MU_GENRES = [
    'Action',
    'Adult',
    'Adventure',
    'Comedy',
    'Doujinshi',
    'Drama',
    'Ecchi',
    'Fantasy',
    'Gender Bender',
    'Harem',
    'Hentai',
    'Historical',
    'Horror',
    'Josei',
    'Lolicon',
    'Martial Arts',
    'Mature',
    'Mecha',
    'Mystery',
    'Psychological',
    'Romance',
    'School Life',
    'Sci-fi',
    'Seinen',
    'Shotacon',
    'Shoujo',
    'Shoujo Ai',
    'Shounen',
    'Shounen Ai',
    'Slice of Life',
    'Smut',
    'Sports',
    'Supernatural',
    'Tragedy',
    'Yaoi',
    'Yuri',
];

const genreKey = (name: string) =>
    name
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, ' ')
        .trim();
const MU_GENRE_BY_KEY = new Map(MU_GENRES.map((genre) => [genreKey(genre), genre]));

/** The MU genre with this AniList name ("Sci-Fi" -> "Sci-fi"), or null. */
export const toMuGenre = (name: string): string | null => MU_GENRE_BY_KEY.get(genreKey(name)) ?? null;

/**
 * AniList-only chips split for an MU search: the ones MU knows as genres go server side, the rest stay a
 * post-filter on the matched AniList media.
 */
export const splitAniListChips = ({ genres, tags }: AniListChips) => {
    const muGenres: { include: string[]; exclude: string[] } = { include: [], exclude: [] };
    const postFilter: AniListChips = { genres: {}, tags: {} };
    (['genres', 'tags'] as const).forEach((kind) =>
        Object.entries(kind === 'genres' ? genres : tags).forEach(([name, state]) => {
            const muGenre = toMuGenre(name);
            if (muGenre) {
                muGenres[state].push(muGenre);
            } else {
                postFilter[kind][name] = state;
            }
        }),
    );
    return { muGenres, postFilter };
};

export type MuSeriesQuery = {
    category: string[];
    genre?: string[];
    exclude_category?: string[];
    exclude_genre?: string[];
    type: string[];
    orderby: MuOrderBy;
    page: number;
    perpage: number;
};

/**
 * The MU queries for one page: every included chip contributes one of its categories (chips are AND, a chip's own
 * categories are OR, so one query per combination, capped at MAX_MU_QUERIES), excluded chips all of theirs.
 * Without a Type filter, only comics (no novels). Adult genres are excluded unless the Adult filter is on.
 */
export const buildMuQueries = ({
    mu,
    muGenres = { include: [], exclude: [] },
    types,
    sort,
    showAdult,
    page,
    perPage = 50,
}: {
    mu: MuSelection;
    /** AniList-only chips that are MU genres (splitAniListChips). */
    muGenres?: { include: string[]; exclude: string[] };
    types: ComicType[];
    sort: string;
    showAdult: boolean;
    page: number;
    perPage?: number;
}): MuSeriesQuery[] => {
    const chips = Object.values(mu).filter(({ categories }) => categories.length);
    const included = chips.filter(({ state }) => state === 'include').map(({ categories }) => categories);
    const excluded = chips.filter(({ state }) => state === 'exclude').flatMap(({ categories }) => categories);
    const excludedGenres = [...new Set([...muGenres.exclude, ...(showAdult ? [] : ADULT_MU_GENRES)])];
    const base = {
        ...(muGenres.include.length ? { genre: [...new Set(muGenres.include)] } : {}),
        ...(excluded.length ? { exclude_category: excluded } : {}),
        ...(excludedGenres.length ? { exclude_genre: excludedGenres } : {}),
        type: (types.length ? types : (Object.keys(MU_TYPES) as ComicType[])).map((type) => MU_TYPES[type]),
        orderby: getMuOrderBy(sort),
        page,
        perpage: perPage,
    };
    const combos = MU_CATEGORY_ARRAY_IS_AND ? cartesian(included) : [included.flat()];
    return combos.slice(0, MAX_MU_QUERIES).map((category) => ({ category, ...base }));
};

export type MuSeries = {
    seriesId: number;
    title: string;
    url: string;
    image: string | null;
    type: string;
    year: number | null;
    rating: number | null;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const getImage = (image: unknown): string | null => {
    if (!isRecord(image)) {
        return null;
    }
    const { url } = image;
    if (typeof url === 'string') {
        return url;
    }
    return isRecord(url) ? ((url.original ?? url.thumb ?? null) as string | null) : null;
};

/** v1/series/search `{ total_hits, results: [{ record }] }` -> series (tolerant). */
export const parseMuSeriesSearch = (json: unknown): { total: number; series: MuSeries[] } => {
    const results = isRecord(json) && Array.isArray(json.results) ? json.results : [];
    const series = results
        .map((result) => (isRecord(result) && isRecord(result.record) ? result.record : null))
        .filter((record): record is Record<string, unknown> => !!record && Number.isFinite(Number(record.series_id)))
        .map((record) => ({
            seriesId: Number(record.series_id),
            title: typeof record.title === 'string' ? record.title : '',
            url: typeof record.url === 'string' ? record.url : '',
            image: getImage(record.image),
            type: typeof record.type === 'string' ? record.type : '',
            year: Number.isFinite(Number(record.year)) && Number(record.year) > 0 ? Number(record.year) : null,
            rating: Number.isFinite(Number(record.bayesian_rating)) ? Number(record.bayesian_rating) : null,
        }));
    return { total: isRecord(json) ? Number(json.total_hits) || 0 : 0, series };
};

/** v1/categories/search -> `{ category, usage }` (tolerant). */
export const parseMuCategorySearch = (json: unknown): { category: string; usage: number }[] =>
    (isRecord(json) && Array.isArray(json.results) ? json.results : [])
        .map((result) => (isRecord(result) && isRecord(result.record) ? result.record : null))
        .filter((record): record is Record<string, unknown> => !!record && typeof record.category === 'string')
        .map((record) => ({ category: record.category as string, usage: Number(record.usage) || 0 }));

/** Several queries' results as one list, first occurrence wins (query order, then MU order). */
export const mergeMuSeries = (lists: MuSeries[][]): MuSeries[] => {
    const seen = new Set<number>();
    return lists.flat().filter(({ seriesId }) => {
        if (seen.has(seriesId)) {
            return false;
        }
        seen.add(seriesId);
        return true;
    });
};

const COUNTRY_BY_MU_TYPE: Record<string, string> = { Manhwa: 'KR', Manhua: 'CN', Manga: 'JP' };

export type AniListCandidate = RecMedia & {
    title: RecMedia['title'] & { native?: string | null };
    synonyms?: (string | null)[] | null;
};

const candidateNames = (media: AniListCandidate) =>
    [
        media.title?.romaji,
        media.title?.english,
        media.title?.native,
        media.title?.userPreferred,
        ...(media.synonyms ?? []),
    ].filter((name): name is string => !!name);

/**
 * The AniList media an MU series is: any candidate one of whose names equals the MU title (normalized); else the
 * top hit when it is very close (similarity >= 0.9), from the country the MU type says, and within a year.
 */
export const pickAniListMatch = (series: MuSeries, candidates: AniListCandidate[]): AniListCandidate | null => {
    const country = COUNTRY_BY_MU_TYPE[series.type];
    const isSameCountry = (media: AniListCandidate) => !country || media.countryOfOrigin === country;
    const isSameYear = (media: AniListCandidate) => {
        const year = media.startDate?.year ?? null;
        return series.year === null || year === null || Math.abs(series.year - year) <= 1;
    };

    // Exact names can collide ("Pick Me Up!" is also a synonym of an older Japanese title): the one from the MU
    // type's country, then within a year, wins; an exact name from another country is not a match.
    const key = normalizeTitle(series.title);
    const exact = key
        ? candidates.filter((media) => candidateNames(media).some((name) => normalizeTitle(name) === key))
        : [];
    const [bestExact] = exact.filter(isSameCountry).sort((a, b) => Number(isSameYear(b)) - Number(isSameYear(a)));
    if (bestExact) {
        return bestExact;
    }

    const [top] = candidates;
    if (!top || exact.length) {
        return null;
    }
    const similarity = Math.max(0, ...candidateNames(top).map((name) => titleSimilarity(series.title, name)));
    return similarity >= 0.9 && isSameCountry(top) && isSameYear(top) ? top : null;
};

/** AniList-only chips applied to matched media (tags need rank >= 60; genres as they are). */
export const passesAniListChips = (media: RecMedia | null, { genres, tags }: AniListChips): boolean => {
    const genreStates = Object.entries(genres);
    const tagStates = Object.entries(tags);
    if (!genreStates.length && !tagStates.length) {
        return true;
    }
    const hasIncluded = [...genreStates, ...tagStates].some(([, state]) => state === 'include');
    if (!media) {
        // An unmatched MU card can't be checked: it drops out only when it would have to have something.
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
 * Card data for an MU series without an AniList match: MU title and cover, no list state (a negative id never
 * matches marks or badges), Find to read by title.
 */
export const toUnmatchedMedia = (series: MuSeries): RecMedia => ({
    id: -series.seriesId,
    idMal: null,
    siteUrl: series.url || null,
    title: { userPreferred: series.title, english: series.title, romaji: null },
    coverImage: { large: series.image },
    description: null,
    averageScore: series.rating !== null ? Math.round(series.rating * 10) : null,
    meanScore: null,
    popularity: null,
    favourites: null,
    countryOfOrigin: COUNTRY_BY_MU_TYPE[series.type] ?? null,
    format: 'MANGA',
    status: null,
    chapters: null,
    isAdult: false,
    startDate: series.year ? { year: series.year, month: null, day: null } : null,
    tags: [],
});

export const isUnmatchedMedia = (media: Pick<RecMedia, 'id'>) => media.id < 0;

/**
 * The cards for MU pages while matches land: a series without a verdict yet shows as its MU card, a matched one as
 * its AniList media (once per AniList id), and the post-filter chips and the Adult filter apply only once the
 * verdict is in, so cards never wait for AniList.
 */
export const toMuCards = (
    pages: MuSeries[][],
    matches: ReadonlyMap<number, RecMedia | null>,
    { postFilter, showAdult }: { postFilter: AniListChips; showAdult: boolean },
): RecMedia[][] => {
    const shownIds = new Set<number>();
    return pages.map((page) =>
        page.flatMap((series) => {
            if (!matches.has(series.seriesId)) {
                return [toUnmatchedMedia(series)];
            }
            const match = matches.get(series.seriesId) ?? null;
            if (!passesAniListChips(match, postFilter) || (!showAdult && match?.isAdult)) {
                return [];
            }
            if (!match) {
                return [toUnmatchedMedia(series)];
            }
            if (shownIds.has(match.id)) {
                return [];
            }
            shownIds.add(match.id);
            return [match];
        }),
    );
};
