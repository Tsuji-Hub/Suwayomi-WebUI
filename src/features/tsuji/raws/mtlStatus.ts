/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { AlignLink } from '@/features/tsuji/raws/rawLinks.ts';

/*
 * "English ran out" (brief #19), pure parts. The MTL engine (mtl-engine v7, through the relay) answers per raw
 * chapter: `GET {api}/s?raw=&ch=` the state, `GET {api}/req?raw=&ch=&sig=` queues it at top priority. `url` is the
 * reader route of the MTL chapter on the server's own WebUI; only its path is used (this WebUI's origin).
 */

export type MtlStatus =
    | { state: 'none' }
    | { state: 'queued'; position: number | null }
    | {
          state: 'running';
          stage: string;
          pagesReady: number | null;
          pagesTotal: number | null;
          elapsed: number | null;
          path: string | null;
      }
    | { state: 'partial'; pagesReady: number | null; pagesTotal: number | null; path: string | null }
    | { state: 'ready'; path: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const toCount = (value: unknown): number | null => {
    const number = Number(value);
    return value !== null && value !== undefined && value !== '' && Number.isFinite(number) && number >= 0
        ? number
        : null;
};

/** "http://192.168.5.85:4567/manga/16353/chapter/1" -> "/manga/16353/chapter/1" (null for anything else). */
export const getReaderPath = (url: unknown): string | null => {
    const match = typeof url === 'string' ? /\/manga\/(\d+)\/chapter\/(\d+)\/?(?:[?#]|$)/.exec(url) : null;
    return match ? `/manga/${match[1]}/chapter/${match[2]}` : null;
};

/** The MTL manga id in a reader path. */
export const getMangaIdFromPath = (path: string | null): number | null => {
    const id = Number(/^\/manga\/(\d+)\//.exec(path ?? '')?.[1]);
    return Number.isInteger(id) && id > 0 ? id : null;
};

/** One `/s` (or `/req`) answer; anything unknown counts as "none". */
export const parseMtlStatus = (json: unknown): MtlStatus => {
    const body = isRecord(json) ? json : {};
    const path = getReaderPath(body.url);
    switch (body.state) {
        case 'queued':
            return { state: 'queued', position: toCount(body.position) };
        case 'running':
            return {
                state: 'running',
                stage: typeof body.stage === 'string' ? body.stage : '',
                pagesReady: toCount(body.pages_ready),
                pagesTotal: toCount(body.pages_total),
                elapsed: toCount(body.elapsed),
                path,
            };
        case 'partial':
            return {
                state: 'partial',
                pagesReady: toCount(body.pages_ready),
                pagesTotal: toCount(body.pages_total),
                path,
            };
        case 'ready':
            return { state: 'ready', path };
        default:
            return { state: 'none' };
    }
};

/** Still moving: poll again. */
export const isMtlPending = (status: MtlStatus | null): boolean =>
    status?.state === 'queued' || status?.state === 'running' || status?.state === 'partial';

/** Where to read it, once there is something to read. */
export const getReadablePath = (status: MtlStatus | null): string | null =>
    status && (status.state === 'running' || status.state === 'partial' || status.state === 'ready')
        ? status.path
        : null;

/** 95 -> "1:35". */
export const formatElapsed = (seconds: number): string => {
    const whole = Math.max(0, Math.floor(seconds));
    return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, '0')}`;
};

/** "Asura Scans (EN)" -> "Asura" (the name the alignment line uses). */
export const getShortSource = (source: string): string =>
    source
        .replaceAll(/\s*\([^)]*\)\s*/g, ' ')
        .trim()
        .replace(/\s+(scans?|comics?|translations?)$/i, '')
        .trim() || source.trim();

/** Same chapter number (meta numbers can be floats: 224.0). */
export const isSameNumber = (a: number | null | undefined, b: number | null | undefined): boolean =>
    a !== null && a !== undefined && b !== null && b !== undefined && Math.abs(a - b) < 1e-6;

export type ReaderAlignLine =
    | { kind: 'follows'; raw: number; en: number; source: string }
    | { kind: 'warning'; verdict: string }
    | null;

/** The reader card's line for `wanted`: the art match confirms the raw's next chapter, or its verdict. */
export const getReaderAlignLine = (align: AlignLink | null, wanted: number): ReaderAlignLine => {
    if (!align) {
        return null;
    }
    if (align.isOk && isSameNumber(align.nextRaw, wanted) && align.en !== null) {
        return { kind: 'follows', raw: wanted, en: align.en, source: getShortSource(align.enSource) };
    }
    return align.verdict ? { kind: 'warning', verdict: align.verdict } : null;
};

export type SeriesAlignLine =
    | { kind: 'match'; en: number; raw: number; source: string }
    | { kind: 'incomplete'; percent: number | null }
    | { kind: 'warning'; verdict: string }
    | null;

/** The series page's line: the raw matches English, the raw upload is incomplete, or the verdict as is. */
export const getSeriesAlignLine = (align: AlignLink | null): SeriesAlignLine => {
    if (!align) {
        return null;
    }
    if (/incomplete/i.test(align.verdict)) {
        return {
            kind: 'incomplete',
            percent: align.lastRaw !== null && align.lastRaw < 1 ? Math.round(align.lastRaw * 100) : null,
        };
    }
    if (align.isOk && align.en !== null && align.raw !== null) {
        return { kind: 'match', en: align.en, raw: align.raw, source: getShortSource(align.enSource) };
    }
    return align.verdict ? { kind: 'warning', verdict: align.verdict } : null;
};

/** Whole chapter numbers strictly between two chapters (the "Missing N" row's numbers), lowest first. */
export const getMissingNumbers = (lower: number, upper: number): number[] => {
    if (!(lower >= 0) || !(upper >= 0)) {
        return [];
    }
    const [low, high] = lower < upper ? [lower, upper] : [upper, lower];
    const numbers: number[] = [];
    for (let number = Math.floor(low) + 1; number < high && numbers.length < 500; number += 1) {
        numbers.push(number);
    }
    return numbers;
};

/** 224 -> "224", 224.5 -> "224.5" (meta and chapter numbers can be floats). */
export const formatNumber = (number: number): string => String(Math.round(number * 100) / 100);
