/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Raws and MTL (brief #6 v2). The server does the work: rawfinder links each Reading-tab series to its best raw and
 * writes manga meta `tsuji_raw_links` on the English copy; mtl-engine translates raw chapters on request into a
 * local-source series "<title> [MTL]". The WebUI only reads that meta and the relay's action feed
 * (`<relay>/mtl/raws.json`), and opens the feed's pre-signed links. Nothing here writes meta or library state.
 */

export type RawLink = { kind: 'raw'; mangaId: number; title: string; source: string };
export type MtlLink = { kind: 'mtl'; mangaId: number };
export type RawLinks = { raw: RawLink | null; mtl: MtlLink | null };

export type Origin = 'KR' | 'CN' | 'JP';

/** One row of raws.json (one per linked series), keyed by `en_id`. URLs are the server's, pre-signed: never built here. */
export type RawFeedRow = {
    title: string;
    enId: number;
    enMax: string;
    rawId: number;
    rawMax: string;
    ahead: number;
    source: string;
    origin: Origin | null;
    uncensored: boolean;
    rawUrl: string;
    mtlUrl: string;
    done: number;
    next: string;
    queued: number;
    tNext: string;
    t10: string;
    tAll: string;
    nAll: number;
    cancel: string;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
    !!value && typeof value === 'object' && !Array.isArray(value);

const toId = (value: unknown): number | null => {
    const id = Number(value);
    return Number.isInteger(id) && id > 0 ? id : null;
};

const toText = (value: unknown): string => {
    if (typeof value === 'string') {
        return value;
    }
    return value === null || value === undefined ? '' : String(value);
};

const toCount = (value: unknown): number => {
    const count = Number(value);
    return Number.isFinite(count) && count > 0 ? Math.floor(count) : 0;
};

/** `tsuji_raw_links` (JSON array on the English manga). Tolerant: anything malformed counts as no link. */
export const parseRawLinks = (raw: string | undefined): RawLinks => {
    const links: RawLinks = { raw: null, mtl: null };
    if (!raw) {
        return links;
    }
    try {
        const parsed: unknown = JSON.parse(raw);
        (Array.isArray(parsed) ? parsed : []).filter(isRecord).forEach((entry) => {
            const mangaId = toId(entry.mangaId);
            if (!mangaId) {
                return;
            }
            if (entry.kind === 'raw' && !links.raw) {
                links.raw = { kind: 'raw', mangaId, title: toText(entry.title), source: toText(entry.source) };
            }
            if (entry.kind === 'mtl' && !links.mtl) {
                links.mtl = { kind: 'mtl', mangaId };
            }
        });
    } catch {
        // malformed meta: no links
    }
    return links;
};

const toOrigin = (value: unknown): Origin | null => (value === 'KR' || value === 'CN' || value === 'JP' ? value : null);

/** raws.json `{ at, linked, rows[] }` -> rows by English manga id. Rows without an `en_id` are dropped. */
export const parseRawFeed = (json: unknown): Map<number, RawFeedRow> => {
    const rows = new Map<number, RawFeedRow>();
    const list = isRecord(json) && Array.isArray(json.rows) ? json.rows : [];
    list.filter(isRecord).forEach((row) => {
        const enId = toId(row.en_id);
        if (!enId) {
            return;
        }
        rows.set(enId, {
            title: toText(row.title),
            enId,
            enMax: toText(row.en_max),
            rawId: toId(row.raw_id) ?? 0,
            rawMax: toText(row.raw_max),
            ahead: toCount(row.ahead),
            source: toText(row.source),
            origin: toOrigin(row.origin),
            uncensored: row.uncensored === true,
            rawUrl: toText(row.raw_url),
            mtlUrl: toText(row.mtl_url),
            done: toCount(row.done),
            next: toText(row.next),
            queued: toCount(row.queued),
            tNext: toText(row.t_next),
            t10: toText(row.t_10),
            tAll: toText(row.t_all),
            nAll: toCount(row.n_all),
            cancel: toText(row.cancel),
        });
    });
    return rows;
};

/** The manga id in a server URL like ".../manga/14377" (opened in-app instead). */
export const getMangaIdFromUrl = (url: string): number | null => toId(/\/manga\/(\d+)(?:[/?#]|$)/.exec(url)?.[1]);

/** The links the series page shows: meta first (raw / mtl ids), the feed row for counts and actions. */
export const getSeriesLinks = (links: RawLinks, row: RawFeedRow | undefined) => {
    const rawId = links.raw?.mangaId ?? (row?.rawId || null);
    const mtlId = links.mtl?.mangaId ?? (row ? getMangaIdFromUrl(row.mtlUrl) : null);
    return {
        rawId,
        rawSource: links.raw?.source || row?.source || '',
        mtlId,
        isUncensored: !!row?.uncensored,
        hasAny: !!rawId || !!mtlId || !!row,
    };
};
