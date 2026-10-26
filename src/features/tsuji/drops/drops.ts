/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TRACKER_ID, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';

/*
 * Drop rate and drop map (brief #20), pure parts. The relay (`<relay>/drops/<anilistId>`, al-drops on CT100) answers
 * AniList's status distribution and a map of where the latest public DROPPED lists stopped; `<relay>/drops/index.json`
 * the drop rate of every cached series for cards. Without the relay, the drop rate comes from AniList's own
 * statusDistribution (same formula, no map). drop % = DROPPED / (CURRENT + COMPLETED + DROPPED + PAUSED): PLANNING
 * (and REPEATING) left out on purpose.
 */

export type DropBand = 'low' | 'typical' | 'high';

export type DropBucket = { from: number; to: number; count: number };
export type DropCliff = { from: number; to: number; count: number; share: number };
export type DropNote = { ch: number | null; text: string };

export type DropMap = {
    state: 'ready' | 'pending' | 'refreshing';
    etaS: number | null;
    /** Drops sampled, with progress, at chapter 0. */
    n: number;
    nProgress: number;
    median: number | null;
    buckets: DropBucket[];
    /** % of mapped droppers in the first bucket. */
    earlyShare: number | null;
    cliffs: DropCliff[];
    max: number | null;
    dropperScore: number | null;
};

export type DropData = {
    id: number;
    chapters: number | null;
    /** Readers who started it (CURRENT + COMPLETED + DROPPED + PAUSED). */
    started: number;
    dropped: number;
    dropPct: number;
    pausePct: number;
    completePct: number;
    map: DropMap | null;
    notes: DropNote[];
    /** `relay`: from al-drops; `anilist`: AniList's statusDistribution only (no map). */
    source: 'relay' | 'anilist';
};

type AniListIdSource = {
    meta?: { key: string; value: string }[] | null;
    trackRecords?: { nodes: { trackerId: number; remoteId?: string | null }[] } | null;
};

const toId = (value: string | null | undefined): number | null => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

/** A series' AniList id without asking AniList: `tsuji_anilistId` (set by Similar), else its AniList track record. */
export const getMangaAniListId = ({ meta, trackRecords }: AniListIdSource): number | null =>
    toId(meta?.find(({ key }) => key === TSUJI_META_KEYS.anilistId)?.value) ??
    toId(trackRecords?.nodes.find(({ trackerId }) => trackerId === TRACKER_ID.ANILIST)?.remoteId);

/** Index entry for cards and the library sort. */
export type DropIndexItem = { dropPct: number; started: number };
export type DropIndex = { medianDropPct: number | null; items: Map<number, DropIndexItem> };

/** Fewer mapped drops than this: no map ("Not enough drops to map"). */
export const MIN_MAPPED_DROPS = 5;
/** Fewer starters than this: no card chip (tiny samples are noise). */
export const MIN_STARTED_FOR_CHIP = 200;
/** An early bounce worth naming: this share of mapped droppers in the first bucket. */
export const EARLY_BOUNCE_SHARE = 10;

const STARTED_STATUSES = ['CURRENT', 'COMPLETED', 'DROPPED', 'PAUSED'] as const;

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const toNumber = (value: unknown): number | null => {
    const number = typeof value === 'string' && value.trim() ? Number(value) : value;
    return typeof number === 'number' && Number.isFinite(number) ? number : null;
};

const toCount = (value: unknown): number => Math.max(0, Math.round(toNumber(value) ?? 0));

const round1 = (value: number) => Math.round(value * 10) / 10;

/** The status counts as percentages of the readers who started it. */
export const getDropRates = (dist: Record<string, number>) => {
    const started = STARTED_STATUSES.reduce((sum, status) => sum + (dist[status] ?? 0), 0);
    const pct = (status: string) => (started ? round1((100 * (dist[status] ?? 0)) / started) : 0);
    return {
        started,
        dropped: dist.DROPPED ?? 0,
        dropPct: pct('DROPPED'),
        pausePct: pct('PAUSED'),
        completePct: pct('COMPLETED'),
    };
};

const parseDist = (value: unknown): Record<string, number> =>
    Object.fromEntries(
        Object.entries(isRecord(value) ? value : {}).map(([status, amount]) => [status, toCount(amount)]),
    );

const parseMap = (value: unknown): DropMap | null => {
    if (!isRecord(value)) {
        return null;
    }
    const state = value.state === 'pending' || value.state === 'refreshing' ? value.state : 'ready';
    const buckets = (Array.isArray(value.buckets) ? value.buckets : []).flatMap((bucket) => {
        const [from, to, count] = Array.isArray(bucket) ? bucket.map(toNumber) : [];
        return from !== null && from !== undefined && to !== null && to !== undefined
            ? [{ from, to, count: Math.max(0, count ?? 0) }]
            : [];
    });
    const cliffs = (Array.isArray(value.cliffs) ? value.cliffs : []).filter(isRecord).flatMap((cliff) => {
        const from = toNumber(cliff.from);
        const to = toNumber(cliff.to);
        return from !== null && to !== null
            ? [{ from, to, count: toCount(cliff.count), share: toNumber(cliff.share) ?? 0 }]
            : [];
    });
    return {
        state,
        etaS: toNumber(value.eta_s),
        n: toCount(value.n),
        nProgress: toCount(value.n_prog),
        median: toNumber(value.median),
        buckets: [...buckets].sort((a, b) => a.from - b.from),
        earlyShare: toNumber(value.early_share),
        cliffs,
        max: toNumber(value.max),
        dropperScore: toNumber(value.dropper_score),
    };
};

/** One `/drops/<id>` answer (null when it isn't one). Rates are recomputed from `dist`, the same formula. */
export const parseDropData = (json: unknown): DropData | null => {
    if (!isRecord(json) || !isRecord(json.dist)) {
        return null;
    }
    const id = toNumber(json.id);
    const rates = getDropRates(parseDist(json.dist));
    if (id === null || !rates.started) {
        return null;
    }
    const notes = (Array.isArray(json.notes) ? json.notes : [])
        .filter(isRecord)
        .flatMap((note) =>
            typeof note.text === 'string' && note.text.trim()
                ? [{ ch: toNumber(note.ch), text: note.text.trim() }]
                : [],
        );
    return {
        id,
        chapters: toNumber(json.chapters),
        ...rates,
        map: parseMap(json.map),
        notes,
        source: 'relay',
    };
};

/** AniList's `stats.statusDistribution` as drop data without a map (the fallback without the relay). */
export const fromStatusDistribution = (
    id: number,
    chapters: number | null,
    distribution: { status: string | null; amount: number | null }[] | null | undefined,
): DropData | null => {
    const dist = Object.fromEntries(
        (distribution ?? []).flatMap(({ status, amount }) => (status ? [[status, Math.max(0, amount ?? 0)]] : [])),
    );
    const rates = getDropRates(dist);
    return rates.started ? { id, chapters, ...rates, map: null, notes: [], source: 'anilist' } : null;
};

/** `/drops/index.json`: drop rate by AniList id, and the library-wide median. */
export const parseDropIndex = (json: unknown): DropIndex => {
    const body = isRecord(json) ? json : {};
    const items = new Map<number, DropIndexItem>();
    Object.entries(isRecord(body.items) ? body.items : {}).forEach(([key, value]) => {
        const id = Number(key);
        const dropPct = isRecord(value) ? toNumber(value.drop_pct) : null;
        if (Number.isInteger(id) && id > 0 && dropPct !== null) {
            items.set(id, { dropPct, started: isRecord(value) ? toCount(value.started) : 0 });
        }
    });
    return { medianDropPct: toNumber(body.median_drop_pct), items };
};

/** Low under 0.75x the median, high over 1.5x, else typical; null without a median. */
export const getDropBand = (dropPct: number, medianDropPct: number | null | undefined): DropBand | null => {
    if (!medianDropPct || medianDropPct <= 0) {
        return null;
    }
    if (dropPct < 0.75 * medianDropPct) {
        return 'low';
    }
    return dropPct > 1.5 * medianDropPct ? 'high' : 'typical';
};

/** "3.2" (one decimal, as the relay). */
export const formatDropPct = (pct: number): string => (Math.round(pct * 10) / 10).toFixed(1);

/** Whether a card chip is worth showing. */
export const hasEnoughStarters = (started: number) => started >= MIN_STARTED_FOR_CHIP;

/** Whether the map has enough mapped drops to draw. */
export const isMapUsable = (map: DropMap | null): map is DropMap =>
    !!map && map.state !== 'pending' && map.nProgress >= MIN_MAPPED_DROPS && map.buckets.length > 0;

export type DropSummary = {
    /** The biggest cliff. */
    cliff: DropCliff | null;
    /** The first bucket when it holds an early bounce. */
    early: { from: number; to: number; share: number } | null;
    /** Half of the droppers quit by this chapter. */
    median: number | null;
};

/** The summary line's parts; a part that doesn't exist is null (no cliff, no early bounce, no median). */
export const getDropSummary = (map: DropMap): DropSummary => {
    const [cliff] = [...map.cliffs].sort((a, b) => b.share - a.share || a.from - b.from);
    const [first] = map.buckets;
    const early =
        first && map.earlyShare !== null && map.earlyShare >= EARLY_BOUNCE_SHARE
            ? { from: first.from, to: first.to, share: Math.round(map.earlyShare) }
            : null;
    return {
        cliff: cliff ?? null,
        early,
        median: map.median !== null && map.median > 0 ? Math.floor(map.median) : null,
    };
};

/** Whether a bucket is (part of) a cliff. */
export const isCliffBucket = (bucket: DropBucket, cliffs: DropCliff[]) =>
    cliffs.some(({ from, to }) => bucket.from >= from && bucket.to <= to);

/** Where a chapter sits on the strip (0..1), or null outside it. */
export const getMarkerFraction = (map: DropMap, chapter: number | null | undefined): number | null => {
    const [first] = map.buckets;
    const last = map.buckets.at(-1);
    if (!first || !last || chapter === null || chapter === undefined || chapter < 0) {
        return null;
    }
    const start = first.from - 1;
    const end = Math.max(last.to, map.max ?? 0);
    return end > start ? Math.min(1, Math.max(0, (chapter - start) / (end - start))) : null;
};

/** Notes up to the reader's chapter, and the ones past it (spoilers until asked). */
export const splitNotes = (notes: DropNote[], readChapter: number | null | undefined) => {
    const read = readChapter ?? 0;
    const sorted = [...notes].sort((a, b) => (a.ch ?? 0) - (b.ch ?? 0));
    return {
        safe: sorted.filter(({ ch }) => ch !== null && ch <= read),
        ahead: sorted.filter(({ ch }) => ch === null || ch > read),
    };
};

/** The library's "Drop rate" sort (brief #20): by drop %, lowest first (highest first descending); unknowns last. */
export const sortByDropRate = <T extends AniListIdSource>(
    mangas: T[],
    index: DropIndex | null,
    isDesc: boolean,
): T[] => {
    const rateOf = (manga: T) => {
        const id = getMangaAniListId(manga);
        return id ? (index?.items.get(id)?.dropPct ?? null) : null;
    };
    return mangas
        .map((manga, position) => ({ manga, position, rate: rateOf(manga) }))
        .sort((a, b) => {
            if (a.rate === null || b.rate === null) {
                return (a.rate === null ? 1 : 0) - (b.rate === null ? 1 : 0) || a.position - b.position;
            }
            return (isDesc ? b.rate - a.rate : a.rate - b.rate) || a.position - b.position;
        })
        .map(({ manga }) => manga);
};
