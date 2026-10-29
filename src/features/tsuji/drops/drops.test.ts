/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    fromStatusDistribution,
    getDropBand,
    getDataDropLine,
    getDropSummary,
    getIndexDropLine,
    getMangaAniListId,
    getMarkerFraction,
    getPeerRank,
    isMapUsable,
    parseDropData,
    parseDropIndex,
    resolveDropBand,
    sortByDropRate,
    splitNotes,
} from '@/features/tsuji/drops/drops.ts';

// The live answer for Solo Leveling (105398), 2026-10-26 (brief #20).
const SOLO_LEVELING = {
    v: 1,
    id: 105398,
    title: 'Solo Leveling',
    status: 'FINISHED',
    chapters: 201,
    format: 'MANGA',
    country: 'KR',
    dist: { CURRENT: 84057, PLANNING: 44295, COMPLETED: 142208, DROPPED: 7736, PAUSED: 9524 },
    started: 243525,
    drop_pct: 3.2,
    pause_pct: 3.9,
    complete_pct: 58.4,
    dist_at: 1792982928,
    map: {
        state: 'ready',
        n: 400,
        n_prog: 284,
        n_zero: 115,
        median: 80.5,
        p25: 26.25,
        p75: 143.0,
        bucket: 15,
        buckets: [
            [1, 15, 48],
            [16, 30, 30],
            [31, 45, 27],
            [46, 60, 21],
            [61, 75, 9],
            [76, 90, 13],
            [91, 105, 10],
            [106, 120, 34],
            [121, 135, 11],
            [136, 150, 19],
            [151, 165, 22],
            [166, 180, 29],
            [181, 195, 6],
            [196, 210, 5],
        ],
        early_share: 16.9,
        cliffs: [{ from: 106, to: 120, count: 34, share: 12.0 }],
        max: 210,
        dropper_score: 50.3,
        score_n: 196,
        at: 1792982928,
        sample: 'latest 400 public DROPPED lists on AniList (newest updates first)',
    },
    notes: [
        { ch: 170, text: 'prime solo leveling was goated, but the ending fell off hard' },
        { ch: 110, text: '#korean propaganda' },
    ],
    src: 'anilist',
    at: 1792982928,
};

describe('drop data', () => {
    const data = parseDropData(SOLO_LEVELING)!;

    it("recomputes the relay's rates from the distribution (PLANNING left out)", () => {
        expect(data).toMatchObject({ id: 105398, started: 243525, dropped: 7736, dropPct: 3.2, pausePct: 3.9 });
        expect(data.completePct).toBe(58.4);
        expect(data.source).toBe('relay');
    });

    it('reads the map: buckets, the cliff, the early share, the median', () => {
        expect(data.map!.buckets).toHaveLength(14);
        expect(data.map!.buckets[7]).toEqual({ from: 106, to: 120, count: 34 });
        expect(getDropSummary(data.map!)).toEqual({
            cliff: { from: 106, to: 120, count: 34, share: 12 },
            cliffs: [{ from: 106, to: 120, count: 34, share: 12 }],
            early: { from: 1, to: 15, share: 17 },
            median: 80,
        });
        expect(isMapUsable(data.map)).toBe(true);
    });

    it("omits the parts that don't exist", () => {
        const flat = { ...data.map!, cliffs: [], earlyShare: 4, median: null };
        expect(getDropSummary(flat)).toEqual({ cliff: null, cliffs: [], early: null, median: null });
    });

    it('two cliffs: the biggest is "the" cliff, both listed by chapter', () => {
        const twoCliffs = {
            ...data.map!,
            cliffs: [
                { from: 121, to: 160, count: 40, share: 9 },
                { from: 21, to: 60, count: 60, share: 14 },
            ],
        };
        const summary = getDropSummary(twoCliffs);
        expect(summary.cliff).toMatchObject({ from: 21, to: 60 });
        expect(summary.cliffs.map(({ from }) => from)).toEqual([21, 121]);
        expect(getDataDropLine({ ...data, map: twoCliffs })).toEqual({ dropPct: 3.2, quit: { from: 21, to: 60 } });
    });

    it('the preview line: no "most quit" without a usable map', () => {
        expect(getDataDropLine({ ...data, map: null })).toEqual({ dropPct: 3.2, quit: null });
        expect(getDataDropLine({ ...data, map: { ...data.map!, nProgress: 2 } }).quit).toBeNull();
    });

    it('a map of under 5 mapped drops is not drawn; a pending one neither', () => {
        expect(isMapUsable({ ...data.map!, nProgress: 4 })).toBe(false);
        expect(isMapUsable({ ...data.map!, state: 'pending' })).toBe(false);
        expect(isMapUsable({ ...data.map!, state: 'refreshing' })).toBe(true);
    });

    it('anything else is no data', () => {
        expect(parseDropData({ error: 'not found on AniList' })).toBeNull();
        expect(parseDropData({ id: 1, dist: {} })).toBeNull();
        expect(parseDropData('nope')).toBeNull();
    });

    it("the marker sits at the reader's chapter on the strip, ongoing series too", () => {
        expect(getMarkerFraction(data.map!, 105)).toBeCloseTo(0.5, 2);
        expect(getMarkerFraction(data.map!, 0)).toBe(0);
        expect(getMarkerFraction(data.map!, 500)).toBe(1);
        expect(getMarkerFraction(data.map!, null)).toBeNull();
        const ongoing = parseDropData({ ...SOLO_LEVELING, chapters: null })!;
        expect(getMarkerFraction(ongoing.map!, 21)).toBeCloseTo(0.1, 2);
    });

    it("notes past the reader's chapter are kept apart (spoilers)", () => {
        expect(splitNotes(data.notes, 120)).toEqual({
            safe: [{ ch: 110, text: '#korean propaganda', orig: null }],
            ahead: [{ ch: 170, text: 'prime solo leveling was goated, but the ending fell off hard', orig: null }],
        });
        expect(splitNotes(data.notes, null).safe).toEqual([]);
    });

    it('translated notes keep the original (tr + orig); orig without tr is ignored', () => {
        const { notes } = parseDropData({
            ...SOLO_LEVELING,
            notes: [
                { ch: 67, text: 'Got boring after the tournament', tr: true, orig: 'Ficou chato depois do torneio' },
                { ch: 68, text: 'fine', orig: 'stray' },
                { ch: 69, text: 'no original', tr: true },
            ],
        })!;
        expect(notes).toEqual([
            { ch: 67, text: 'Got boring after the tournament', orig: 'Ficou chato depois do torneio' },
            { ch: 68, text: 'fine', orig: null },
            { ch: 69, text: 'no original', orig: null },
        ]);
    });
});

describe('v6 (al-drops since 2026-10-29)', () => {
    const v6 = parseDropData({
        ...SOLO_LEVELING,
        id: 170400,
        status: 'RELEASING',
        label: 'low',
        pctile: 5,
        peer: 'ongoing manhwa',
        peer_n: 115,
        peer_med: 6.2,
        ci: [2.2, 2.5],
        drop_hi: 4.8,
        map: { ...SOLO_LEVELING.map, cliffs: [], zero_share: 26, caught_up_share: 41 },
    })!;

    it('reads the peer label, the range, the on-hold rate and the map shares', () => {
        expect(v6).toMatchObject({
            status: 'RELEASING',
            label: 'low',
            pctile: 5,
            peer: 'ongoing manhwa',
            peerN: 115,
            peerMedian: 6.2,
            ci: [2.2, 2.5],
            dropHi: 4.8,
        });
        expect(v6.map).toMatchObject({ zeroShare: 26, caughtUpShare: 41, cliffs: [] });
        expect(getPeerRank(5)).toEqual({ direction: 'lower', share: 95 });
        expect(getPeerRank(80)).toEqual({ direction: 'higher', share: 80 });
    });

    it("the server's label wins (null: none); without the field, the library-median rule", () => {
        expect(resolveDropBand(v6.label, 2.3, 50, 8.5)).toBe('low');
        expect(resolveDropBand(parseDropData({ ...SOLO_LEVELING, label: null })!.label, 3.2, 243525, 5.1)).toBeNull();
        expect(parseDropData(SOLO_LEVELING)!.label).toBeUndefined();
        expect(resolveDropBand(undefined, 3.2, 243525, 5.1)).toBe('low');
        expect(resolveDropBand(undefined, 12, 150, 5.1)).toBeNull();
        expect(resolveDropBand(parseDropData({ ...SOLO_LEVELING, label: 'odd' })!.label, 3.2, 243525, 5.1)).toBeNull();
    });

    it('index items: lab, last English release (s -> ms) and the usual gap', () => {
        const index = parseDropIndex({
            v: 6,
            items: {
                1: { drop_pct: 2.3, started: 900, lab: 'low', pc: 5, peer: 'ongoing manhwa', lr: 1_761_000_000, gm: 7 },
                2: { drop_pct: 9, started: 90, lab: null },
                3: { drop_pct: 5, started: 900 },
            },
        });
        expect(index.items.get(1)).toMatchObject({ label: 'low', lastRelease: 1_761_000_000_000, gapDays: 7 });
        expect(index.items.get(2)).toMatchObject({ label: null, lastRelease: null, gapDays: null });
        expect(index.items.get(3)!.label).toBeUndefined();
    });
});

describe('AniList fallback and bands', () => {
    it("AniList's statusDistribution, same formula, no map", () => {
        const data = fromStatusDistribution(105398, 201, [
            { status: 'CURRENT', amount: 84057 },
            { status: 'PLANNING', amount: 44295 },
            { status: 'COMPLETED', amount: 142208 },
            { status: 'DROPPED', amount: 7736 },
            { status: 'PAUSED', amount: 9524 },
            { status: 'REPEATING', amount: 1000 },
        ]);
        expect(data).toMatchObject({ dropPct: 3.2, started: 243525, map: null, source: 'anilist' });
        expect(fromStatusDistribution(1, null, [])).toBeNull();
    });

    it('low under 0.75x the median, high over 1.5x', () => {
        expect(getDropBand(3.2, 5.1)).toBe('low');
        expect(getDropBand(7.1, 5.1)).toBe('typical');
        expect(getDropBand(8, 5.1)).toBe('high');
        expect(getDropBand(3.2, null)).toBeNull();
    });
});

const manga = (title: string, anilistId: string | null, viaMeta = false) => ({
    title,
    meta: viaMeta && anilistId ? [{ key: 'tsuji_anilistId', value: anilistId }] : [],
    trackRecords: { nodes: !viaMeta && anilistId ? [{ trackerId: 2, remoteId: anilistId }] : [] },
});

describe('index and library sort', () => {
    const index = parseDropIndex({
        v: 1,
        median_drop_pct: 5.1,
        n: 3,
        items: {
            105398: { drop_pct: 3.2, started: 243525, median: 80.5, cliffs: [[106, 120]] },
            151025: { drop_pct: 7.1, started: 30210 },
            999: { drop_pct: 'x' },
        },
    });
    it('drop rate by AniList id, the median', () => {
        expect(index.medianDropPct).toBe(5.1);
        expect(index.items.get(151025)).toEqual({
            dropPct: 7.1,
            started: 30210,
            cliffs: [],
            lastRelease: null,
            gapDays: null,
        });
        const shared = parseDropIndex({
            items: {
                1: {
                    drop_pct: 5,
                    started: 900,
                    cliffs: [
                        [21, 60, 25],
                        [121, 160, 28],
                    ],
                },
                2: { drop_pct: 5, started: 900, cliffs: [{ from: 1, to: 10 }, null, [30, 40]] },
            },
        });
        expect(getIndexDropLine(shared.items.get(1)!).quit).toEqual({ from: 121, to: 160 });
        expect(getIndexDropLine(shared.items.get(2)!).quit).toEqual({ from: 1, to: 10 });
        expect(getIndexDropLine(index.items.get(105398)!)).toEqual({ dropPct: 3.2, quit: { from: 106, to: 120 } });
        expect(getIndexDropLine(index.items.get(151025)!)).toEqual({ dropPct: 7.1, quit: null });
        expect(index.items.has(999)).toBe(false);
    });

    it('the AniList id: meta first, else the AniList track record', () => {
        expect(getMangaAniListId(manga('a', '105398', true))).toBe(105398);
        expect(getMangaAniListId(manga('b', '151025'))).toBe(151025);
        expect(getMangaAniListId(manga('c', null))).toBeNull();
    });

    it('sorts by drop rate, unknowns last both ways', () => {
        const list = [manga('Unknown', null), manga('Mythic', '151025'), manga('Solo', '105398', true)];
        expect(sortByDropRate(list, index, false).map(({ title }) => title)).toEqual(['Solo', 'Mythic', 'Unknown']);
        expect(sortByDropRate(list, index, true).map(({ title }) => title)).toEqual(['Mythic', 'Solo', 'Unknown']);
        expect(sortByDropRate(list, null, false).map(({ title }) => title)).toEqual(['Unknown', 'Mythic', 'Solo']);
    });
});
