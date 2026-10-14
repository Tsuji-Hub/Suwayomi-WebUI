/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { normalizeTitle } from '@/features/tsuji/recs/normalize.ts';
import type { Comment, SeriesCandidate } from '@/features/tsuji/comments/CommentSource.ts';

/*
 * Comick, as Makimono reads it (pure parts; the client is comickSource.ts):
 *   search:   /v1.0/search?q=&limit=10&t=false   -> [{ id, hid, title, md_titles? }]
 *   chapters: /comic/{hid}/chapters?lang=en&limit=100000 -> { chapters: [{ hid, chap, up_count, ... }] }
 *   comments: /comment/chapter/{chapterHid}?lang=en&comic-id={id}&chap={n} -> { comments: [...] }
 */

/** Makimono's smart-match threshold. */
export const MATCH_THRESHOLD = 0.7;

export type ComickSearchResult = {
    id: number;
    hid: string;
    title: string | null;
    md_titles?: { title: string | null }[] | null;
};

export type ComickChapter = { hid: string; chap: string | null; up_count?: number | null };

type ComickRawComment = {
    id: number | string;
    content?: string | null;
    up_count?: number | null;
    created_at?: string | null;
    identities?: { traits?: { username?: string | null } | null } | null;
    other_comments?: ComickRawComment[] | null;
};

/** "hid|id" (Makimono's series key). */
export const formatSeriesKey = (hid: string, id: number) => `${hid}|${id}`;

export const parseSeriesKey = (key: string | null | undefined): { hid: string; id: number } | null => {
    const match = /^([A-Za-z0-9_-]+)\|(\d+)$/.exec(key ?? '');
    return match ? { hid: match[1], id: Number(match[2]) } : null;
};

const bigrams = (value: string) => {
    const compact = value.replaceAll(' ', '');
    return Array.from({ length: Math.max(0, compact.length - 1) }, (_, index) => compact.slice(index, index + 2));
};

/** Sørensen-Dice over character bigrams of the normalized titles: 1 = same title, 0 = nothing shared. */
export const titleSimilarity = (a: string, b: string): number => {
    const left = normalizeTitle(a);
    const right = normalizeTitle(b);
    if (!left || !right) {
        return 0;
    }
    if (left === right) {
        return 1;
    }
    const leftBigrams = bigrams(left);
    const rightBigrams = bigrams(right);
    if (!leftBigrams.length || !rightBigrams.length) {
        return 0;
    }
    const pool = new Map<string, number>();
    rightBigrams.forEach((gram) => pool.set(gram, (pool.get(gram) ?? 0) + 1));
    const shared = leftBigrams.filter((gram) => {
        const count = pool.get(gram) ?? 0;
        if (count > 0) {
            pool.set(gram, count - 1);
            return true;
        }
        return false;
    }).length;
    return (2 * shared) / (leftBigrams.length + rightBigrams.length);
};

/** Every search result scored against the manga's titles (best of title / alternative titles). */
export const scoreSearchResults = (titles: string[], results: ComickSearchResult[]): SeriesCandidate[] =>
    results
        .map((result) => {
            const names = [result.title, ...(result.md_titles ?? []).map(({ title }) => title)].filter(
                (name): name is string => !!name,
            );
            const score = Math.max(0, ...titles.flatMap((title) => names.map((name) => titleSimilarity(title, name))));
            return { seriesKey: formatSeriesKey(result.hid, result.id), title: result.title ?? names[0] ?? '', score };
        })
        .sort((a, b) => b.score - a.score);

export const pickBestMatch = (titles: string[], results: ComickSearchResult[]): SeriesCandidate | null => {
    const [best] = scoreSearchResults(titles, results);
    return best && best.score >= MATCH_THRESHOLD ? best : null;
};

/**
 * Chapter number -> chapter hid, from the whole chapter list (fetched once per comic): one entry per `chap`, the
 * scanlation with the most up-votes. Keys stay strings as Comick sends them ("200.5").
 */
export const reduceChapterMap = (chapters: ComickChapter[]): Record<string, string> => {
    const best = new Map<string, { hid: string; votes: number }>();
    chapters.forEach(({ hid, chap, up_count: upCount }) => {
        const key = chap?.trim();
        if (!key || !hid) {
            return;
        }
        const votes = upCount ?? 0;
        const current = best.get(key);
        if (!current || votes > current.votes) {
            best.set(key, { hid, votes });
        }
    });
    return Object.fromEntries([...best.entries()].map(([key, { hid }]) => [key, hid]));
};

/** The map key for a Suwayomi chapter number: exact string first ("12"), then numeric equality ("012", "12.0"). */
export const findChapterKey = (chapterMap: Record<string, string>, chapterNumber: number): string | null => {
    if (!Number.isFinite(chapterNumber) || chapterNumber < 0) {
        return null;
    }
    const exact = String(chapterNumber);
    if (exact in chapterMap) {
        return exact;
    }
    return Object.keys(chapterMap).find((key) => Number(key) === chapterNumber) ?? null;
};

export const mapComickComment = (raw: ComickRawComment): Comment => ({
    id: String(raw.id),
    author: raw.identities?.traits?.username?.trim() || 'Anonymous',
    createdAt: raw.created_at ?? null,
    body: raw.content ?? '',
    upCount: Math.max(0, raw.up_count ?? 0),
    replies: (raw.other_comments ?? []).map(mapComickComment),
});
