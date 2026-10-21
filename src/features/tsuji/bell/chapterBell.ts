/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { hasCopies } from '@/features/tsuji/duplicates/duplicateChapters.ts';

/*
 * New-chapter bell (brief #10, rules v2 from brief #12, the same as Cowork's Glance widget): one entry per library
 * series in the watched categories (default `ongoing` + `Completed`) that got chapters after the reader was last
 * there, with at most 2 chapters already waiting before them. Seen state is a per-series watermark (highest chapter
 * number seen) in the global meta shards `tsuji_bell_0` .. `tsuji_bell_15` (bucket = mangaId % 16), each
 * `{"<mangaId>": <number>}`, merged on write like `tsuji_seen`.
 */

export const DEFAULT_WATCHED_CATEGORY_NAMES = ['ongoing', 'completed'];

export const BELL_REFRESH_MS = 10 * 60 * 1000;

/** Most series whose chapters the bell reads (the most recently updated ones). */
export const BELL_MAX_SERIES = 300;
/** Series per chapters request. */
export const BELL_CHAPTER_BATCH = 60;
/** Chapters already waiting before the new ones that still count as caught up (Log into the Future: 355). */
export const BELL_MAX_WAITING = 2;

/** First run after deploy: only the newest 30 entries start unseen. */
export const FIRST_RUN_UNSEEN = 30;

const DAY_SECONDS = 24 * 60 * 60;

export type BellCategory = { id: number; name: string };

export type BellManga = {
    id: number;
    title: string;
    thumbnailUrl: string | null;
    /** The watched category it was found in (its chip in the list). */
    category: string;
    inLibrary: boolean;
    /** Seconds or milliseconds (normalized by toSeconds). */
    inLibraryAt: number;
    unreadCount: number;
    /** When the reader last read a chapter of it (0 = never). */
    lastReadAt: number;
    /** Fetch time of its newest chapter (ranks series for the 300 cap). */
    latestFetchedAt: number;
};

export type BellChapter = {
    id: number;
    mangaId: number;
    chapterNumber: number;
    /** Epoch seconds. */
    fetchedAt: number;
    sourceOrder: number;
    isRead: boolean;
};

export type BellEntry = {
    mangaId: number;
    title: string;
    thumbnailUrl: string | null;
    category: string;
    /** Distinct numbers above the highest read one (waiting + arrived), ascending. */
    numbers: number[];
    /** The chapter a click opens: the earliest copy of the first number. */
    firstChapter: { id: number; sourceOrder: number };
    /** Epoch seconds of the newest arrived chapter. */
    newestFetchedAt: number;
};

/** The watched category ids: the saved choice, else the categories named ongoing / Completed. */
export const resolveWatchedCategories = (categories: BellCategory[], saved: number[] | null): number[] =>
    saved ??
    categories
        .filter(({ name }) => DEFAULT_WATCHED_CATEGORY_NAMES.includes(name.trim().toLowerCase()))
        .map(({ id }) => id);

/** Saved category ids (JSON array), null when unset or unreadable. */
export const parseWatchedCategories = (raw: string | undefined): number[] | null => {
    if (!raw) {
        return null;
    }
    try {
        const ids: unknown = JSON.parse(raw);
        return Array.isArray(ids) ? ids.filter((id): id is number => Number.isInteger(id)) : null;
    } catch {
        return null;
    }
};

/** Epoch seconds from a server timestamp in seconds or milliseconds (above 1e11 = ms). */
export const toSeconds = (value: number): number => (value > 1e11 ? Math.floor(value / 1000) : value);

/**
 * The series whose chapters the bell reads: in the library with something unread, each once, at most 300 (the
 * most recently updated first).
 */
export const pickBellSeries = (mangas: BellManga[]): BellManga[] => {
    const byId = new Map<number, BellManga>();
    mangas.forEach((manga) => {
        if (manga.inLibrary && manga.unreadCount > 0 && !byId.has(manga.id)) {
            byId.set(manga.id, manga);
        }
    });
    return [...byId.values()]
        .sort((a, b) => toSeconds(b.latestFetchedAt) - toSeconds(a.latestFetchedAt) || a.id - b.id)
        .slice(0, BELL_MAX_SERIES);
};

/**
 * One series' entry, or null. Highest read = the highest read chapter NUMBER (not the last by source order); the
 * boundary = when the reader was last there (last read, or a day after adding it to the library, whichever is
 * later). Chapters above the highest read fetched by then are waiting, later ones arrived. An entry needs at least
 * one arrived and at most 2 waiting numbers; copies of one number are one chapter (brief #4), chapters without a
 * number are ignored.
 */
export const buildBellEntry = (manga: BellManga, chapters: BellChapter[]): BellEntry | null => {
    const numbered = chapters.filter(({ chapterNumber }) => hasCopies(chapterNumber));
    const highestRead = Math.max(
        -1,
        ...numbered.filter(({ isRead }) => isRead).map(({ chapterNumber }) => chapterNumber),
    );
    const boundary = Math.max(toSeconds(manga.lastReadAt), toSeconds(manga.inLibraryAt) + DAY_SECONDS);
    const above = numbered.filter(({ isRead, chapterNumber }) => !isRead && chapterNumber > highestRead);
    const arrived = above.filter(({ fetchedAt }) => toSeconds(fetchedAt) > boundary);
    const waiting = new Set(
        above.filter(({ fetchedAt }) => toSeconds(fetchedAt) <= boundary).map(({ chapterNumber }) => chapterNumber),
    );
    if (!arrived.length || waiting.size > BELL_MAX_WAITING) {
        return null;
    }
    const numbers = [...new Set(above.map(({ chapterNumber }) => chapterNumber))].sort((a, b) => a - b);
    const [first] = above
        .filter(({ chapterNumber }) => chapterNumber === numbers[0])
        .sort((a, b) => a.sourceOrder - b.sourceOrder);
    return {
        mangaId: manga.id,
        title: manga.title,
        thumbnailUrl: manga.thumbnailUrl,
        category: manga.category,
        numbers,
        firstChapter: { id: first.id, sourceOrder: first.sourceOrder },
        newestFetchedAt: Math.max(...arrived.map(({ fetchedAt }) => toSeconds(fetchedAt))),
    };
};

/** The bell's entries, newest arrival first. */
export const buildBellEntries = (mangas: BellManga[], chapters: BellChapter[]): BellEntry[] => {
    const byManga = new Map<number, BellChapter[]>();
    chapters.forEach((chapter) => byManga.set(chapter.mangaId, [...(byManga.get(chapter.mangaId) ?? []), chapter]));
    return mangas
        .map((manga) => buildBellEntry(manga, byManga.get(manga.id) ?? []))
        .filter((entry): entry is BellEntry => !!entry)
        .sort((a, b) => b.newestFetchedAt - a.newestFetchedAt || a.title.localeCompare(b.title));
};

/** Highest new number: what a "seen" watermark records. */
export const getEntryTop = (entry: Pick<BellEntry, 'numbers'>) => entry.numbers[entry.numbers.length - 1];

export const isUnseen = (entry: BellEntry, watermarks: ReadonlyMap<number, number>) => {
    const seen = watermarks.get(entry.mangaId);
    return seen === undefined || getEntryTop(entry) > seen;
};

// --- Seen watermarks in global meta -----------------------------------------------------------------------------

export const BELL_SHARD_COUNT = 16;
/** Headroom under the server's 4096 chars (and out of upstream's 4000-char chunker). */
export const BELL_BUCKET_MAX_CHARS = 3800;
const SHARD_PREFIX = 'tsuji_bell_';

export const getBellBucket = (mangaId: number) => mangaId % BELL_SHARD_COUNT;
export const getBellShardKey = (bucket: number) => `${SHARD_PREFIX}${bucket}`;
export const BELL_SHARD_KEYS = Array.from({ length: BELL_SHARD_COUNT }, (_, bucket) => getBellShardKey(bucket));

type RawMeta = Partial<Record<string, string>>;

/** Tolerant parse of one bucket: entries that aren't `"<positive id>": <number>` are dropped. */
export const parseBellBucket = (raw: string | undefined): Map<number, number> => {
    const watermarks = new Map<number, number>();
    if (!raw) {
        return watermarks;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            Object.entries(parsed).forEach(([key, value]) => {
                const id = Number(key);
                if (Number.isInteger(id) && id > 0 && typeof value === 'number' && Number.isFinite(value)) {
                    watermarks.set(id, value);
                }
            });
        }
    } catch {
        // An unreadable bucket counts as empty; the next write replaces it.
    }
    return watermarks;
};

/** Every watermark in the meta (all buckets come in the one global meta request). */
export const readBellWatermarks = (meta: RawMeta): Map<number, number> =>
    new Map(BELL_SHARD_KEYS.flatMap((key) => [...parseBellBucket(meta[key])]));

export class BellBucketFullError extends Error {
    constructor(
        readonly bucket: number,
        readonly length: number,
    ) {
        super(`tsuji_bell bucket ${bucket} would be ${length} chars (max ${BELL_BUCKET_MAX_CHARS}); nothing was saved`);
        this.name = 'BellBucketFullError';
    }
}

/**
 * The keys to write for these watermarks, merged into the server's current buckets: a watermark only rises, and
 * only the touched buckets are written. Throws BellBucketFullError (nothing written) when a bucket would overflow.
 */
export const planBellWrite = (meta: RawMeta, patch: ReadonlyMap<number, number>): [key: string, value: string][] => {
    const touched = new Map<number, Map<number, number>>();
    patch.forEach((value, mangaId) => {
        const bucket = getBellBucket(mangaId);
        const current = touched.get(bucket) ?? parseBellBucket(meta[getBellShardKey(bucket)]);
        touched.set(bucket, current);
        current.set(mangaId, Math.max(current.get(mangaId) ?? Number.NEGATIVE_INFINITY, value));
    });
    return [...touched.entries()]
        .sort(([a], [b]) => a - b)
        .flatMap(([bucket, watermarks]) => {
            const before = meta[getBellShardKey(bucket)];
            const value = JSON.stringify(Object.fromEntries([...watermarks.entries()].sort(([a], [b]) => a - b)));
            if (value.length > BELL_BUCKET_MAX_CHARS) {
                throw new BellBucketFullError(bucket, value.length);
            }
            return value === before ? [] : [[getBellShardKey(bucket), value] as [string, string]];
        });
};

/** Watermarks that mark entries seen. */
export const toWatermarks = (entries: BellEntry[]): Map<number, number> =>
    new Map(entries.map((entry) => [entry.mangaId, getEntryTop(entry)]));

/** First run: everything new is unseen except beyond the newest 30, which start seen. */
export const getFirstRunSeen = (entries: BellEntry[]): Map<number, number> =>
    toWatermarks(entries.slice(FIRST_RUN_UNSEEN));

/** "152", "152.5". */
const formatNumber = (value: number) => String(Math.round(value * 100) / 100);

/** "Ch 152" or "Ch 152-154" (the count goes beside it in the UI). */
export const formatChapterRange = (numbers: number[]): string => {
    const [first] = numbers;
    const last = numbers[numbers.length - 1];
    return first === last ? formatNumber(first) : `${formatNumber(first)}-${formatNumber(last)}`;
};

/** Badge text: hidden at 0 (empty), 99+ above 99. */
export const formatBellCount = (count: number): string => {
    if (count <= 0) {
        return '';
    }
    return count > 99 ? '99+' : String(count);
};

/** The relative time unit for "x ago" (Intl.RelativeTimeFormat does the words). */
export const getRelativeTime = (
    fetchedAtSeconds: number,
    nowMs: number,
): { value: number; unit: Intl.RelativeTimeFormatUnit } => {
    const seconds = Math.round(fetchedAtSeconds - nowMs / 1000);
    const minutes = Math.round(seconds / 60);
    const hours = Math.round(seconds / 3600);
    const days = Math.round(seconds / 86_400);
    if (Math.abs(minutes) < 60) {
        return { value: Math.min(minutes, 0), unit: 'minute' };
    }
    if (Math.abs(hours) < 24) {
        return { value: hours, unit: 'hour' };
    }
    return { value: days, unit: 'day' };
};

/** "(3) Library" while something is unseen; the prefix is replaced, never stacked. */
export const withTitleCount = (title: string, count: number): string => {
    const bare = title.replace(/^\(\d+\+?\) /, '');
    return count > 0 ? `(${formatBellCount(count)}) ${bare}` : bare;
};
