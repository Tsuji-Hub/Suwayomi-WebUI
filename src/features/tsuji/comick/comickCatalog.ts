/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ComicType, RecMedia, RecMediaStatus, RecTag } from '@/features/tsuji/recs/Recs.types.ts';
import { getAniListLink } from '@/features/tsuji/comments/aniListResolve.ts';
import { titleSimilarity } from '@/features/tsuji/comments/comick.ts';

/*
 * Comick as a catalog (brief #15; pure parts, the client is ComickService.ts). Through the comments relay
 * (`/comick/` -> api.comick.dev; Comick sends no CORS headers). Checked live 2026-10-21:
 *   search: /v1.0/search?sort=&country=&minimum=&status=&limit=&page= -> [{ id, hid, slug, title, country, status,
 *           last_chapter, year, genres (ids), content_rating, bayesian_rating, user_follow_count, md_covers, ... }]
 *   genres: /genre/ -> [{ id, name, slug }]
 *   comic:  /comic/{slug}/ -> { comic: { links: { al, mal, mu, mb }, recommendations: [{ up, down, total,
 *           relates: { title, slug, hid, ... } }], md_comic_md_genres, mu_comic_categories, ... } }
 * A card keys on `links.al` when Comick has it (list, library and read marks then work as for AniList cards), else
 * on a negative id (no list state; "Find to read" by title), and says "via Comick".
 */

/** Negative ids for Comick cards without an AniList id: apart from MangaBaka's (-series id, far smaller). */
const COMICK_ID_OFFSET = 1_000_000_000;

const COVER_HOST = 'https://meo.comick.pictures';

const STATUS_BY_COMICK: Record<number, RecMediaStatus> = {
    1: 'RELEASING',
    2: 'FINISHED',
    3: 'CANCELLED',
    4: 'HIATUS',
};
const COMICK_BY_STATUS = Object.fromEntries(
    Object.entries(STATUS_BY_COMICK).map(([code, status]) => [status, Number(code)]),
) as Partial<Record<RecMediaStatus, number>>;

const COUNTRY_BY_TYPE: Record<ComicType, string> = { MANHWA: 'kr', MANHUA: 'cn', MANGA: 'jp' };

const ADULT_RATINGS = new Set(['erotica', 'pornographic']);
/** How close an alternative title must be to the slug to be the name the slug spells. */
const SLUG_MATCH = 0.8;
/** Comick's title this close to the slug is the same name, written its own way. */
const SAME_NAME = 0.5;

/** Discover's sorts on Comick: Trending = views, Most popular = follows, Highest rated = rating. */
export const COMICK_SORTS: Record<string, string> = {
    TRENDING: 'view',
    POPULARITY: 'follow',
    SCORE: 'rating',
    NEWEST: 'created_at',
    BEST: 'follow',
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' ? (value as Record<string, unknown>) : {};
const asNumber = (value: unknown): number | null => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
};
const asString = (value: unknown): string | null => (typeof value === 'string' && value.trim() ? value : null);
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/** Genre id -> name, from `/genre/`. */
export type ComickGenres = Record<string, string>;

export const parseComickGenres = (json: unknown): ComickGenres =>
    Object.fromEntries(
        asList(json).flatMap((row) => {
            const genre = asRecord(row);
            const id = asNumber(genre.id);
            const name = asString(genre.name);
            return id !== null && name ? [[String(id), name]] : [];
        }),
    );

/** The search parameters for one page: Discover's filters Comick can apply server side; the rest stay client side. */
export const buildComickSearch = ({
    sort,
    types,
    statuses,
    minChapters,
    page,
    limit,
}: {
    sort: string;
    types: ComicType[];
    statuses: RecMediaStatus[];
    minChapters: number;
    page: number;
    limit: number;
}): string => {
    const params = new URLSearchParams();
    params.set('sort', COMICK_SORTS[sort] ?? 'follow');
    (types.length ? types : (Object.keys(COUNTRY_BY_TYPE) as ComicType[]))
        .map((type) => COUNTRY_BY_TYPE[type])
        .sort()
        .forEach((country) => params.append('country', country));
    // One status server side; several stay a client filter.
    const [onlyStatus] = statuses;
    if (statuses.length === 1 && COMICK_BY_STATUS[onlyStatus] !== undefined) {
        params.set('status', String(COMICK_BY_STATUS[onlyStatus]));
    }
    if (minChapters > 0) {
        params.set('minimum', String(minChapters));
    }
    params.set('page', String(page));
    params.set('limit', String(limit));
    params.set('t', 'false');
    return params.toString();
};

const parseCover = (covers: unknown): string | null => {
    const key = asString(asRecord(asList(covers)[0]).b2key);
    return key ? `${COVER_HOST}/${key}` : null;
};

/** Alternative titles, English ones first (`md_titles: [{ title, lang }]`). */
const parseTitles = (row: Record<string, unknown>) =>
    asList(row.md_titles)
        .map((entry) => ({ title: asString(asRecord(entry).title), lang: asString(asRecord(entry).lang) }))
        .filter((entry): entry is { title: string; lang: string | null } => !!entry.title)
        .sort((a, b) => Number(b.lang === 'en') - Number(a.lang === 'en'))
        .map(({ title }) => title);

/** "00-omniscient-readers-viewpoint" -> "Omniscient Readers Viewpoint" (Comick slugs follow the English name). */
export const titleFromSlug = (slug: string | null): string | null => {
    const words = (slug ?? '')
        .replace(/^\d+-(?=[a-z])/i, '')
        .split('-')
        .filter(Boolean);
    return words.length >= 2 ? words.map((word) => word[0].toUpperCase() + word.slice(1)).join(' ') : null;
};

/**
 * The English title to show (r3434: Comick's own title is often a literal translation, "I am the only the one who
 * levels up" for Solo Leveling): an alternative title close to the slug (English ones first), else the slug as a
 * title, else Comick's title. Makimono does the same.
 */
export const pickComickTitle = (title: string, slug: string | null, alternatives: string[]): string => {
    const fromSlug = titleFromSlug(slug);
    // Close to the slug (punctuation, a word more or less): Comick's title is the English one.
    if (!fromSlug || titleSimilarity(title, fromSlug) >= SAME_NAME) {
        return title;
    }
    return alternatives.find((alternative) => titleSimilarity(alternative, fromSlug) >= SLUG_MATCH) ?? fromSlug;
};

/** Comick's tags of a comic: MangaDex genres (by id from search, by name on the comic) and MangaUpdates categories. */
const parseTags = (row: Record<string, unknown>, genres: ComickGenres): RecTag[] => {
    const names = [
        ...asList(row.genres).map((id) => genres[String(asNumber(id) ?? asString(id))] ?? null),
        ...asList(row.md_comic_md_genres).map((entry) => asString(asRecord(asRecord(entry).md_genres).name)),
        ...asList(row.mu_comic_categories).map((entry) => asString(asRecord(asRecord(entry).mu_categories).title)),
    ].filter((name): name is string => !!name);
    return [...new Set(names)].map((name) => ({ name, rank: 60, category: 'Comick' }));
};

/** A stable number for a slug (cards need numeric ids). */
const hashSlug = (slug: string): number => {
    let hash = 0;
    for (let index = 0; index < slug.length; index += 1) {
        hash = (Math.imul(hash, 31) + slug.charCodeAt(index)) >>> 0;
    }
    return hash % COMICK_ID_OFFSET;
};

/**
 * A Comick row's AniList id: `links.al` (comic pages) or `external_ids.anilist` (search results, brief #21); null for
 * recommendations, which carry neither.
 */
export const getComickAniListId = (row: Record<string, unknown>): number | null =>
    getAniListLink(row.links) ?? getAniListLink({ al: asRecord(row.external_ids).anilist });

/** `uploaded_at` (the latest chapter, search results only) in ms, or null. */
const parseUploadedAt = (value: unknown): number | null => {
    const time = typeof value === 'string' ? Date.parse(value) : Number.NaN;
    return Number.isFinite(time) ? time : null;
};

/** A Comick comic (search hit, comic page or recommendation) as a card. */
export const toComickMedia = (raw: unknown, genres: ComickGenres = {}): RecMedia | null => {
    const row = asRecord(raw);
    const comickId = asNumber(row.id);
    const slug = asString(row.slug);
    const title = asString(row.title);
    if ((comickId === null && !slug) || !title) {
        return null;
    }
    const anilistId = getComickAniListId(row);
    const rating = asNumber(row.bayesian_rating);
    const country = asString(row.country)?.toUpperCase() ?? null;
    const lastChapter = asNumber(row.last_chapter);
    const year = asNumber(row.year);
    const alternatives = parseTitles(row);
    const shown = pickComickTitle(title, slug, alternatives);
    return {
        id: anilistId ?? -(COMICK_ID_OFFSET + (comickId ?? hashSlug(slug!))),
        idMal: asNumber(asRecord(row.links).mal),
        siteUrl: slug ? `https://comick.io/comic/${slug}` : null,
        // Comick's own title stays as an alternative: list and duplicate matching try it too.
        title: {
            userPreferred: shown,
            english: shown,
            romaji: shown !== title ? title : (alternatives.find((alternative) => alternative !== title) ?? null),
        },
        coverImage: { large: parseCover(row.md_covers) },
        description: asString(row.desc)?.slice(0, 500) ?? null,
        averageScore: rating !== null ? Math.round(rating * 10) : null,
        meanScore: null,
        popularity: asNumber(row.user_follow_count),
        favourites: null,
        countryOfOrigin: country === 'CN' || country === 'HK' || country === 'TW' ? 'CN' : country,
        format: 'MANGA',
        status: STATUS_BY_COMICK[asNumber(row.status) ?? 0] ?? null,
        chapters: lastChapter !== null ? Math.floor(lastChapter) : null,
        isAdult: ADULT_RATINGS.has(asString(row.content_rating) ?? ''),
        startDate: year ? { year, month: null, day: null } : null,
        tags: parseTags(row, genres),
        via: 'comick',
        lastChapterAt: parseUploadedAt(row.uploaded_at),
        // Comick's own score until AniList's replaces it (cards with an AniList id, brief #21).
        scoreSource: 'comick',
    };
};

/** One page of `/v1.0/search` as cards (each comic once). */
export const parseComickSearch = (json: unknown, genres: ComickGenres): RecMedia[] => {
    const seen = new Set<number>();
    return asList(json).flatMap((row) => {
        const media = toComickMedia(row, genres);
        if (!media || seen.has(media.id)) {
            return [];
        }
        seen.add(media.id);
        return [media];
    });
};

/** A Comick recommendation: the comic and its votes. */
export type ComickRecommendation = { media: RecMedia; votes: number };

/** `/comic/{slug}/`: its AniList id, and its recommendations by votes (each comic once). */
export const parseComickComic = (
    json: unknown,
    genres: ComickGenres = {},
): { anilistId: number | null; hid: string | null; recommendations: ComickRecommendation[] } => {
    const root = asRecord(json);
    const comic = asRecord(root.comic);
    const seen = new Set<number>();
    const recommendations = asList(comic.recommendations ?? root.recommendations)
        .flatMap((entry) => {
            const recommendation = asRecord(entry);
            const media = toComickMedia(recommendation.relates, genres);
            if (!media || seen.has(media.id)) {
                return [];
            }
            seen.add(media.id);
            const votes =
                asNumber(recommendation.total) ??
                (asNumber(recommendation.up) ?? 0) - (asNumber(recommendation.down) ?? 0);
            return [{ media, votes }];
        })
        .sort((a, b) => b.votes - a.votes);
    return { anilistId: getAniListLink(comic.links), hid: asString(comic.hid), recommendations };
};
