/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { SpacedQueue } from '@/features/tsuji/services/RequestQueue.ts';
import { createRelayClient } from '@/features/tsuji/comments/comickSource.ts';
import { getCommentsRelayUrl } from '@/features/tsuji/comments/relayUrl.ts';
import { rankComickHits } from '@/features/tsuji/comments/aniListResolve.ts';
import type { ComickSearchResult } from '@/features/tsuji/comments/comick.ts';
import { titleSimilarity } from '@/features/tsuji/comments/comick.ts';
import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';
import { compactMedia } from '@/features/tsuji/forYou/weekStore.ts';
import type { AniListTitleEntry, ComickGenres, ComickRecommendation } from '@/features/tsuji/comick/comickCatalog.ts';
import type { SearchResponse } from '@/features/tsuji/recs/aniListQueries.ts';
import { SEARCH_QUERY } from '@/features/tsuji/recs/aniListQueries.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { AniListHealth } from '@/features/tsuji/services/aniListHealth.ts';
import {
    findComickRow,
    findLinkedTwin,
    getAniListSearchTitles,
    getComickAniListId,
    getOtherSearchTitle,
    matchAniListEntry,
    parseComickComic,
    parseComickGenres,
    parseComickSearch,
    toComickMedia,
} from '@/features/tsuji/comick/comickCatalog.ts';

/*
 * Comick through the comments relay for Discover, Similar and For You (brief #15). The relay allows 120 requests a
 * minute (burst 60) under Comick's 200; comments keep their own slower queue, so this one stays near 100 a minute:
 * one every 0.6 s after a burst of 10. Search pages are kept for the session, comics (their AniList id and
 * recommendations) a week, AniList id -> Comick slug a month.
 */

const SPACING_MS = 600;
const BURST = 10;
const TIMEOUT_MS = 8000;
const GENRES_TTL_MS = 7 * DAY_MS;
const COMIC_TTL_MS = 7 * DAY_MS;
const SLUG_TTL_MS = 30 * DAY_MS;
const SLUG_MISS_TTL_MS = DAY_MS;
/** Titles tried per AniList entry (English first, then synonyms). */
const MAX_TITLES = 2;
/** Recommendations kept per comic. */
const MAX_RECOMMENDATIONS = 30;

const client = createRelayClient({
    getBaseUrl: getCommentsRelayUrl,
    queue: new SpacedQueue(SPACING_MS, { burst: BURST }),
    timeoutMs: TIMEOUT_MS,
});

let pendingGenres: Promise<ComickGenres> | null = null;

/** Comick's genres (id -> name), cached a week; none if Comick doesn't answer (cards then go without tags). */
export const loadComickGenres = (signal: AbortSignal): Promise<ComickGenres> => {
    const cached = TsujiCache.get<ComickGenres>('comick:genres:v1');
    if (cached) {
        return Promise.resolve(cached);
    }
    pendingGenres ??= client
        .get<unknown>('/genre/', signal)
        .then((json) => {
            const genres = parseComickGenres(json);
            if (Object.keys(genres).length) {
                TsujiCache.set('comick:genres:v1', genres, GENRES_TTL_MS);
            }
            return genres;
        })
        .catch(() => ({}))
        .finally(() => {
            pendingGenres = null;
        });
    return pendingGenres;
};

const searchMemo = new Map<string, RecMedia[]>();

/** One search page (`query` from buildComickSearch) as cards, kept for the session. */
export const searchComick = async (query: string, signal: AbortSignal): Promise<RecMedia[]> => {
    const memoized = searchMemo.get(query);
    if (memoized) {
        return memoized;
    }
    const genres = await loadComickGenres(signal);
    const media = parseComickSearch(await client.get<unknown>(`/v1.0/search?${query}`, signal), genres);
    if (media.length) {
        searchMemo.set(query, media);
    }
    return media;
};

type StoredComic = { anilistId: number | null; recommendations: ComickRecommendation[] };

/** A comic's AniList id and recommendations (30, by votes), cached a week; null when Comick has no such comic. */
export const loadComickComic = async (slug: string, signal: AbortSignal): Promise<StoredComic | null> => {
    // v2 (brief #17): v1 pages were saved as cards before r3435's title rule ("I am the only the one who levels up").
    const key = `comick:comic:v2:${slug}`;
    const cached = TsujiCache.get<StoredComic | { none: true }>(key);
    if (cached) {
        return 'none' in cached ? null : cached;
    }
    const json = await client.get<unknown>(`/comic/${encodeURIComponent(slug)}/`, signal);
    if (json === null) {
        TsujiCache.set(key, { none: true }, SLUG_MISS_TTL_MS);
        return null;
    }
    const parsed = parseComickComic(json, await loadComickGenres(signal));
    const comic: StoredComic = {
        anilistId: parsed.anilistId,
        recommendations: parsed.recommendations
            .slice(0, MAX_RECOMMENDATIONS)
            .map(({ media, votes }) => ({ media: compactMedia(media), votes })),
    };
    TsujiCache.set(key, comic, COMIC_TTL_MS);
    return comic;
};

type ComickHit = ComickSearchResult & { slug?: string | null; links?: unknown };

/**
 * The Comick slug of an AniList entry, or null: a title search (English first, then a synonym), and only a hit whose
 * `links.al` is the AniList id counts (read from its comic page when the hit doesn't carry it; that page is the one
 * the recommendations come from, so it is cached for them). Cached a month, a miss a day.
 */
export const resolveComickSlug = async (
    anilistId: number,
    titles: string[],
    signal: AbortSignal,
): Promise<string | null> => {
    const key = `comick:al:v1:${anilistId}`;
    const cached = TsujiCache.get<{ slug: string | null }>(key);
    if (cached) {
        return cached.slug;
    }
    const tried = new Set<string>();
    const findIn = async (title: string): Promise<string | null> => {
        const hits =
            (await client.get<ComickHit[]>(`/v1.0/search?q=${encodeURIComponent(title)}&limit=10&t=false`, signal)) ??
            [];
        for (const hit of rankComickHits(title, hits)) {
            const { slug } = hit;
            if (slug && !tried.has(slug)) {
                tried.add(slug);
                const linked =
                    getComickAniListId(hit as unknown as Record<string, unknown>) ??
                    // oxlint-disable-next-line no-await-in-loop
                    (await loadComickComic(slug, signal))?.anilistId ??
                    null;
                if (linked === anilistId) {
                    return slug;
                }
            }
        }
        return null;
    };
    let found: string | null = null;
    for (const title of [...new Set(titles.filter(Boolean))].slice(0, MAX_TITLES)) {
        // One title after the other: the first usually finds it.
        // oxlint-disable-next-line no-await-in-loop
        found ??= await findIn(title);
    }
    TsujiCache.set(key, { slug: found }, found ? SLUG_TTL_MS : SLUG_MISS_TTL_MS);
    return found;
};

/** A title search hit counts as the same series from this similarity on (no AniList id to check it by). */
const TITLE_MATCH = 0.85;

/**
 * The Comick slug of a series known only by its title (a library title without an AniList track record): the best
 * search hit when its title or an alternative is close enough. Cached a month, a miss a day.
 */
export const resolveComickSlugByTitle = async (title: string, signal: AbortSignal): Promise<string | null> => {
    const key = `comick:title:v1:${normalizeTitle(title) || title}`;
    const cached = TsujiCache.get<{ slug: string | null }>(key);
    if (cached) {
        return cached.slug;
    }
    const hits =
        (await client.get<ComickHit[]>(`/v1.0/search?q=${encodeURIComponent(title)}&limit=10&t=false`, signal)) ?? [];
    const [best] = rankComickHits(title, hits);
    const score = best
        ? Math.max(
              titleSimilarity(title, best.title ?? ''),
              ...(best.md_titles ?? []).map((alternative) => titleSimilarity(title, alternative.title ?? '')),
          )
        : 0;
    const slug = best?.slug && score >= TITLE_MATCH ? best.slug : null;
    TsujiCache.set(key, { slug }, slug ? SLUG_TTL_MS : SLUG_MISS_TTL_MS);
    return slug;
};

/** Comick's recommendations for an AniList entry (by votes), or none when Comick doesn't have it. */
export const loadComickRecommendations = async (
    anilistId: number,
    titles: string[],
    signal: AbortSignal,
): Promise<ComickRecommendation[]> => {
    const slug = await resolveComickSlug(anilistId, titles, signal);
    return slug ? ((await loadComickComic(slug, signal))?.recommendations ?? []) : [];
};

/** Comick's recommendations for a series known only by its title. */
export const loadComickRecommendationsByTitle = async (
    title: string,
    signal: AbortSignal,
): Promise<ComickRecommendation[]> => {
    const slug = await resolveComickSlugByTitle(title, signal);
    return slug ? ((await loadComickComic(slug, signal))?.recommendations ?? []) : [];
};

/**
 * What a Comick search row says about a series (brief #21): its AniList id, status and latest chapter date; `card`:
 * what the card shows instead when the AniList id came from elsewhere (Comick's linked entry, or AniList by title).
 */
export type ComickSeriesInfo = {
    anilistId: number | null;
    status: string | null;
    lastChapterAt: number | null;
    card?: Partial<Pick<RecMedia, 'title' | 'siteUrl' | 'coverImage'>> | null;
};

const INFO_TTL_MS = 7 * DAY_MS;
const FRESHNESS_TTL_MS = DAY_MS;

const searchJson = (title: string, signal: AbortSignal): Promise<unknown> =>
    client.get<unknown>(`/v1.0/search?q=${encodeURIComponent(title)}&limit=10&t=false`, signal);

const searchRows = async (title: string, signal: AbortSignal): Promise<RecMedia[]> =>
    parseComickSearch(await searchJson(title, signal), {});

const toInfo = (media: RecMedia | undefined): ComickSeriesInfo | null =>
    media
        ? {
              anilistId: media.id > 0 ? media.id : null,
              status: media.status,
              lastChapterAt: media.lastChapterAt ?? null,
          }
        : null;

/** AniList by title for an unlinked Comick entry: the exact title / synonym / native match, or null (or a failure). */
const findOnAniList = async (
    titles: string[],
    signal: AbortSignal,
): Promise<{ entry: AniListTitleEntry | null; failed: boolean }> => {
    if (AniListHealth.isDown()) {
        return { entry: null, failed: true };
    }
    try {
        for (const title of titles) {
            // One title after the other: the first (Comick's own, junk number stripped) usually matches.
            // oxlint-disable-next-line no-await-in-loop
            const { Page } = await aniList.request<SearchResponse>(
                SEARCH_QUERY,
                { search: title },
                { signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
            );
            const entry = matchAniListEntry(titles, Page?.media ?? []);
            if (entry) {
                return { entry, failed: false };
            }
        }
        return { entry: null, failed: false };
    } catch {
        return { entry: null, failed: true };
    }
};

/**
 * A Comick recommendation's series (its entry carries only a slug, a title and Comick's numbers): the search row with
 * that slug, by its title. Comick lists some series twice, one entry unlinked ("...Divine Pets!404"); for an unlinked
 * entry, a linked one in the results sharing any title lends its AniList id (one more Comick search by the original
 * title when needed), else AniList itself by title (junk number stripped, then the original title; an exact title,
 * synonym or native match only). Cached a week (a miss, or AniList not answering, a day). Similar hides by the AniList
 * id and dates the card by it.
 */
export const loadComickRecInfo = async (
    slug: string,
    title: string,
    signal: AbortSignal,
): Promise<ComickSeriesInfo | null> => {
    // v3: v1 / v2 kept "...Divine Pets!404" unlinked (r3456 and r3457 checks).
    const key = `comick:slug:v3:${slug}`;
    const cached = TsujiCache.get<{ info: ComickSeriesInfo | null }>(key);
    if (cached) {
        return cached.info;
    }
    const json = await searchJson(title, signal);
    const row = findComickRow(json, slug);
    const media = row ? toComickMedia(row) : null;
    const info = media ? toInfo(media) : null;
    let isShortLived = !info;
    if (row && info && info.anilistId === null) {
        let twin = findLinkedTwin(row, json);
        const otherTitle = twin ? null : getOtherSearchTitle(row);
        if (otherTitle) {
            twin = findLinkedTwin(row, await searchJson(otherTitle, signal));
        }
        const twinMedia = twin ? toComickMedia(twin) : null;
        if (twinMedia) {
            info.anilistId = twinMedia.id;
            info.status = twinMedia.status ?? info.status;
            info.lastChapterAt = Math.max(info.lastChapterAt ?? 0, twinMedia.lastChapterAt ?? 0) || null;
            info.card = { title: twinMedia.title, siteUrl: twinMedia.siteUrl, coverImage: twinMedia.coverImage };
        } else {
            const titles = getAniListSearchTitles(row);
            const { entry, failed } = await findOnAniList(titles, signal);
            isShortLived = failed;
            if (entry) {
                const shown = titles[0] ?? media!.title?.english ?? null;
                info.anilistId = entry.id;
                info.card = {
                    title: { userPreferred: shown, english: shown, romaji: entry.title?.romaji ?? null },
                };
            }
        }
    }
    TsujiCache.set(key, { info }, isShortLived ? SLUG_MISS_TTL_MS : INFO_TTL_MS);
    return info;
};

/**
 * When an AniList series' latest chapter came out, for the freshness tag on AniList cards (brief #21): Comick's search
 * row whose AniList id is this one (English title first, then a synonym). One lookup per series a day.
 */
export const loadComickFreshness = async (
    anilistId: number,
    titles: string[],
    signal: AbortSignal,
): Promise<ComickSeriesInfo | null> => {
    const key = `comick:fresh:v1:${anilistId}`;
    const cached = TsujiCache.get<{ info: ComickSeriesInfo | null }>(key);
    if (cached) {
        return cached.info;
    }
    let info: ComickSeriesInfo | null = null;
    for (const title of [...new Set(titles.filter(Boolean))].slice(0, MAX_TITLES)) {
        if (info) {
            break;
        }
        // oxlint-disable-next-line no-await-in-loop
        info = toInfo((await searchRows(title, signal)).find(({ id }) => id === anilistId));
    }
    TsujiCache.set(key, { info }, FRESHNESS_TTL_MS);
    return info;
};
