/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { CommentsCache, RelayClient } from '@/features/tsuji/comments/comickSource.ts';
import type { ComickSearchResult } from '@/features/tsuji/comments/comick.ts';
import { formatSeriesKey, titleSimilarity } from '@/features/tsuji/comments/comick.ts';

/*
 * Comments in the Discover / For You / Similar preview (brief #8): the series is resolved by AniList id, never by a
 * fuzzy title. Comick candidates come from a title search and only one whose `links.al` is the AniList id counts.
 * When the AniList titles find nothing, MangaDex (whose manga carry `links.al` too) supplies more title variants.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
export const AL_MATCH_TTL_MS = 7 * DAY_MS;
export const AL_MISS_TTL_MS = DAY_MS;
const CANDIDATES_PER_TITLE = 3;
const MAX_TITLES = 3;

type ComickHit = ComickSearchResult & { slug?: string | null; links?: unknown };

/** `links.al` as a number (Comick and MangaDex both store it as a string). */
export const getAniListLink = (links: unknown): number | null => {
    if (!links || typeof links !== 'object') {
        return null;
    }
    const id = Number((links as Record<string, unknown>).al);
    return Number.isInteger(id) && id > 0 ? id : null;
};

/** The search hits worth a closer look: most similar to the title first, at most 3. */
export const rankComickHits = (title: string, hits: ComickHit[]): ComickHit[] =>
    hits
        .map((hit) => ({
            hit,
            score: Math.max(
                titleSimilarity(title, hit.title ?? ''),
                ...(hit.md_titles ?? []).map(({ title: alternative }) => titleSimilarity(title, alternative ?? '')),
            ),
        }))
        .sort((a, b) => b.score - a.score)
        .slice(0, CANDIDATES_PER_TITLE)
        .map(({ hit }) => hit);

type MangaDexManga = {
    attributes?: {
        title?: Record<string, string>;
        altTitles?: Record<string, string>[];
        links?: unknown;
    };
};

/** English / romanized titles of the MangaDex manga linked to this AniList id (none when no manga is). */
export const getMangaDexTitles = (json: unknown, anilistId: number): string[] => {
    const data = (json as { data?: MangaDexManga[] } | null)?.data ?? [];
    const manga = data.find(({ attributes }) => getAniListLink(attributes?.links) === anilistId);
    if (!manga?.attributes) {
        return [];
    }
    const { title = {}, altTitles = [] } = manga.attributes;
    return [
        ...Object.values(title),
        ...altTitles.flatMap((entry) =>
            Object.entries(entry)
                .filter(([language]) => /^(en|ja-ro|ko-ro|zh-ro)$/.test(language))
                .map(([, value]) => value),
        ),
    ].filter((value, index, list) => !!value && list.indexOf(value) === index);
};

export type AniListResolveDeps = { comick: RelayClient; mangadex: RelayClient; cache: CommentsCache };

/** Comick "hid|id" for the AniList entry, or null; verdicts are cached (a week, misses a day). */
export const resolveComickByAniList = async (
    { anilistId, titles }: { anilistId: number; titles: string[] },
    { comick, mangadex, cache }: AniListResolveDeps,
    signal: AbortSignal,
): Promise<string | null> => {
    const key = `comments:al:v1:${anilistId}`;
    const cached = cache.get<{ seriesKey: string | null }>(key);
    if (cached) {
        return cached.seriesKey;
    }

    const tried = new Set<string>();
    const verify = async (title: string): Promise<string | null> => {
        const hits =
            (await comick.get<ComickHit[]>(`/v1.0/search?q=${encodeURIComponent(title)}&limit=10&t=false`, signal)) ??
            [];
        for (const hit of rankComickHits(title, hits)) {
            if (tried.has(hit.hid)) {
                continue;
            }
            tried.add(hit.hid);
            let linked = getAniListLink(hit.links);
            if (linked === null && hit.slug) {
                // oxlint-disable-next-line no-await-in-loop
                const detail = await comick.get<{ comic?: { links?: unknown } }>(
                    `/comic/${encodeURIComponent(hit.slug)}/`,
                    signal,
                );
                linked = getAniListLink(detail?.comic?.links);
            }
            if (linked === anilistId) {
                return formatSeriesKey(hit.hid, hit.id);
            }
        }
        return null;
    };

    const tryTitles = async (list: string[]) => {
        for (const title of list.filter(Boolean).slice(0, MAX_TITLES)) {
            // oxlint-disable-next-line no-await-in-loop
            const found = await verify(title);
            if (found) {
                return found;
            }
        }
        return null;
    };

    let seriesKey = await tryTitles([...new Set(titles)]);
    if (!seriesKey && titles[0]) {
        const json = await mangadex
            .get<unknown>(`/manga?title=${encodeURIComponent(titles[0])}&limit=5`, signal)
            .catch(() => null);
        seriesKey = await tryTitles(getMangaDexTitles(json, anilistId).filter((title) => !titles.includes(title)));
    }

    cache.set(key, { seriesKey }, seriesKey ? AL_MATCH_TTL_MS : AL_MISS_TTL_MS);
    return seriesKey;
};
