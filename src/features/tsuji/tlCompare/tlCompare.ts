/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * "Compare translations" (brief #16): when a series has two English uploads, the server's `tlcompare` service
 * (VM110, v2) samples 8 chapters of each and writes what it found to the manga meta `tsuji_tlCompare`: who made
 * each upload (watermarks), words for the same thing, words only one uses, translator notes, image size. The WebUI
 * asks for a check with the global meta `tsuji_tlRequest_<mangaId>` = epoch seconds (picked up within a minute,
 * about 30 min for a new series, removed when done). Nothing else: no other host is called.
 */

/** Results before v2 have no groups and no drift: shown as stale (a Re-check link only). */
export const TL_COMPARE_VERSION = 2;

export type TlVariant = {
    name: string;
    /** Who made the upload, from watermarks / credits; "" when none found, " / " between names when it changed hands. */
    group: string;
    groupHits: number;
    /** The group per sampled chapter. */
    groupByCh: [number, string][];
    chapters: number;
    widthMin: number;
    widthMax: number;
    pagesAvg: number;
    words: number;
    /** Translator notes in the sampled chapters. */
    tn: number;
};

/** Words for the same thing: `a` in variants[0], `b` in variants[1]; drift = sampled chapters using the other word. */
export type TlTerm = { a: string; b: string; countA: number; countB: number; driftA: number[]; driftB: number[] };

export type TlWord = { w: string; n: number; other: number };

export type TlCompare = {
    v: number;
    /** Epoch seconds of the check. */
    at: number;
    source: string;
    status: string;
    error?: string;
    sampled: number[];
    variants: TlVariant[];
    terms: TlTerm[];
    onlyA: TlWord[];
    onlyB: TlWord[];
};

const asRecord = (value: unknown): Record<string, unknown> =>
    value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asNumber = (value: unknown, fallback = 0): number =>
    typeof value === 'number' && Number.isFinite(value) ? value : fallback;
const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asList = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asNumbers = (value: unknown): number[] =>
    asList(value).filter((item): item is number => typeof item === 'number' && Number.isFinite(item));

const parseVariant = (raw: unknown): TlVariant => {
    const variant = asRecord(raw);
    return {
        name: asString(variant.name),
        group: asString(variant.group).trim(),
        groupHits: asNumber(variant.groupHits),
        groupByCh: asList(variant.groupByCh).flatMap((entry) => {
            const [chapter, group] = asList(entry);
            return typeof chapter === 'number' ? [[chapter, asString(group).trim()] as [number, string]] : [];
        }),
        chapters: asNumber(variant.chapters),
        widthMin: asNumber(variant.widthMin),
        widthMax: asNumber(variant.widthMax),
        pagesAvg: asNumber(variant.pagesAvg),
        words: asNumber(variant.words),
        tn: asNumber(variant.tn),
    };
};

const parseWords = (value: unknown): TlWord[] =>
    asList(value).flatMap((raw) => {
        const word = asRecord(raw);
        const w = asString(word.w);
        return w ? [{ w, n: asNumber(word.n), other: asNumber(word.other) }] : [];
    });

/** The manga meta value, or null when absent or not JSON; missing fields default to empty. */
export const parseTlCompare = (raw: string | undefined): TlCompare | null => {
    if (!raw) {
        return null;
    }
    let json: unknown;
    try {
        json = JSON.parse(raw);
    } catch {
        return null;
    }
    const root = asRecord(json);
    if (!Object.keys(root).length) {
        return null;
    }
    return {
        v: asNumber(root.v, 1),
        at: asNumber(root.at),
        source: asString(root.source),
        status: asString(root.status),
        error: asString(root.error) || undefined,
        sampled: asNumbers(root.sampled),
        variants: asList(root.variants).map(parseVariant),
        terms: asList(root.terms).flatMap((entry) => {
            const term = asRecord(entry);
            const a = asString(term.a);
            const b = asString(term.b);
            return a && b
                ? [
                      {
                          a,
                          b,
                          countA: asNumber(term.countA),
                          countB: asNumber(term.countB),
                          driftA: asNumbers(term.driftA),
                          driftB: asNumbers(term.driftB),
                      },
                  ]
                : [];
        }),
        onlyA: parseWords(root.onlyA),
        onlyB: parseWords(root.onlyB),
    };
};

/** What the series page shows for a result. */
export type TlView = 'card' | 'stale' | 'error' | 'none';

export const getTlView = (result: TlCompare | null): TlView => {
    if (!result) {
        return 'none';
    }
    if (result.v < TL_COMPARE_VERSION) {
        return 'stale';
    }
    if (result.status === 'error') {
        return 'error';
    }
    return result.status === 'ok' && result.variants.length === 2 ? 'card' : 'none';
};

/** "(re-upload site)": a site that re-posted someone else's work, often at a lower image quality. */
export const isReuploadSite = (name: string) => /\(re-?upload site\)/i.test(name);

/** The first name of a group ("UTOON (re-upload site) / AcloudMerge ..." -> "UTOON (re-upload site)"). */
export const getPrimaryGroup = (group: string): string => group.split(' / ')[0]?.trim() ?? '';

export type GroupRun = { from: number; to: number; name: string };

/** Consecutive sampled chapters with the same (first) group as one run: ch 1-200 Asura Scans, 251 Manhwa Freak... */
export const getGroupRuns = (groupByCh: [number, string][]): GroupRun[] =>
    groupByCh.reduce<GroupRun[]>((runs, [chapter, group]) => {
        const name = getPrimaryGroup(group) || '?';
        const last = runs.at(-1);
        if (last && last.name === name) {
            last.to = chapter;
            return runs;
        }
        return [...runs, { from: chapter, to: chapter, name }];
    }, []);

export const formatRunRange = ({ from, to }: Pick<GroupRun, 'from' | 'to'>) =>
    from === to ? `${from}` : `${from}-${to}`;

/** The global meta key that asks the service to (re-)check a series. */
export const getTlRequestKey = (mangaId: number) => `tsuji_tlRequest_${mangaId}`;

/** Seconds of clock difference between this device and the server tolerated when matching a result to a request. */
const CLOCK_SLACK_S = 120;

/** A request is answered once a result at least as new as it is in. */
export const isRequestAnswered = (requestedAt: number | null, result: TlCompare | null): boolean =>
    requestedAt === null || (!!result && result.at >= requestedAt - CLOCK_SLACK_S);

/** The scanlator values of the chapters (an upload per value), each once. */
export const getScanlators = (chapters: { scanlator?: string | null }[]): string[] => [
    ...new Set(chapters.map(({ scanlator }) => scanlator?.trim() ?? '').filter(Boolean)),
];

/** The variant the chapter list follows: the other one is excluded and it isn't. */
export const getActiveVariant = (excluded: string[], names: string[]): string | null =>
    names.find(
        (name) => !excluded.includes(name) && names.some((other) => other !== name && excluded.includes(other)),
    ) ?? null;
