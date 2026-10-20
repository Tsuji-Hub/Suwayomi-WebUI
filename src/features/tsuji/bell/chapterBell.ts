/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { hasCopies } from '@/features/tsuji/duplicates/duplicateChapters.ts';

/*
 * New-chapter bell (brief #10): one entry per library series in the watched categories (default `ongoing` +
 * `Completed`) that was caught up and got new chapters since. Seen state is a per-series watermark (highest chapter
 * number seen) in the global meta shards `tsuji_bell_0` .. `tsuji_bell_15` (bucket = mangaId % 16), each
 * `{"<mangaId>": <number>}`, merged on write like `tsuji_seen`.
 */

export const DEFAULT_WATCHED_CATEGORY_NAMES = ['ongoing', 'completed'];

/** Recent window of the bell query: unread library chapters fetched in the last 60 days, newest first. */
export const BELL_WINDOW_DAYS = 60;
export const BELL_MAX_CHAPTERS = 1500;
export const BELL_REFRESH_MS = 10 * 60 * 1000;

/** First run after deploy: only the newest 30 entries start unseen. */
export const FIRST_RUN_UNSEEN = 30;

export type BellCategory = { id: number; name: string };

export type BellManga = {
    id: number;
    title: string;
    thumbnailUrl: string | null;
    /** Unread chapters of the series at query time (all of them, with or without a number). */
    unreadCount: number;
    /** Number of the highest (by source order) read chapter; null when nothing is read. */
    latestReadNumber: number | null;
    categories: BellCategory[];
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
    /** Distinct new chapter numbers, ascending. */
    numbers: number[];
    /** The chapter a click opens: the first new number (its earliest copy). */
    firstChapter: { id: number; sourceOrder: number };
    /** Epoch seconds of the newest fetch. */
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

/**
 * The bell's entries, newest fetch first. A series counts when it is in a watched category, was caught up (no unread
 * chapter older than the window: its unread count equals its unread chapters in the window) and has unread chapters
 * numbered above the highest one read. Unread copies at or below that number (a new scanlator's copy of a chapter
 * already read) and chapters without a number are ignored; copies of one number are one chapter (brief #4).
 */
export const buildBellEntries = ({
    mangas,
    chapters,
    watchedCategoryIds,
}: {
    mangas: BellManga[];
    /** Unread when the query ran; `isRead` may have changed since (reading clears an entry). */
    chapters: BellChapter[];
    watchedCategoryIds: number[];
}): BellEntry[] => {
    const watched = new Set(watchedCategoryIds);
    const byManga = new Map<number, BellChapter[]>();
    chapters.forEach((chapter) => byManga.set(chapter.mangaId, [...(byManga.get(chapter.mangaId) ?? []), chapter]));

    return mangas
        .flatMap((manga): BellEntry[] => {
            const category = manga.categories.find(({ id }) => watched.has(id));
            const inWindow = byManga.get(manga.id) ?? [];
            const highestRead = manga.latestReadNumber;
            if (!category || highestRead === null || !hasCopies(highestRead) || manga.unreadCount > inWindow.length) {
                return [];
            }
            const fresh = inWindow
                .filter((chapter) => !chapter.isRead && hasCopies(chapter.chapterNumber))
                .filter((chapter) => chapter.chapterNumber > highestRead);
            if (!fresh.length) {
                return [];
            }
            const numbers = [...new Set(fresh.map(({ chapterNumber }) => chapterNumber))].sort((a, b) => a - b);
            const [first] = fresh
                .filter(({ chapterNumber }) => chapterNumber === numbers[0])
                .sort((a, b) => a.sourceOrder - b.sourceOrder);
            return [
                {
                    mangaId: manga.id,
                    title: manga.title,
                    thumbnailUrl: manga.thumbnailUrl,
                    category: category.name,
                    numbers,
                    firstChapter: { id: first.id, sourceOrder: first.sourceOrder },
                    newestFetchedAt: Math.max(...fresh.map(({ fetchedAt }) => fetchedAt)),
                },
            ];
        })
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
