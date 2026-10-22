/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import {
    formatRunRange,
    getActiveVariant,
    getGroupRuns,
    getScanlators,
    getTlRequestKey,
    getTlView,
    isRequestAnswered,
    getFirstOutSkew,
    isReuploadSite,
    parseSeen,
    parseTlCompare,
    toTitleCase,
} from '@/features/tsuji/tlCompare/tlCompare.ts';

/** The live value for The Game That I Came From (3526), 2026-10-22 (brief #16b: votes, matched terms). */
const LIVE_3526 =
    '{"v":2,"at":1792614714,"source":"MangaFire (EN)","status":"ok","sampled":[1,51,101,151,200,251,301,351],"variants":[{"name":"unofficial","group":"Asura Scans / UTOON (re-upload site) / Manhwa Freak","groupHits":38,"groupByCh":[[1,"Asura Scans"],[51,"Asura Scans"],[101,"Asura Scans"],[151,"Asura Scans"],[200,"Asura Scans"],[251,"Manhwa Freak"],[301,"UTOON (re-upload site)"],[351,"UTOON (re-upload site) / AcloudMerge (re-upload site) / ColaManga (re-upload site)"]],"chapters":359,"widthMin":201,"widthMax":1280,"pagesAvg":78.2,"words":5467,"tn":3},{"name":"official","group":"Kuaikan / WebComics app","groupHits":36,"groupByCh":[[1,"Kuaikan"],[51,"Kuaikan"],[101,"Kuaikan"],[151,"Kuaikan"],[200,"Kuaikan"],[251,"Kuaikan"],[301,"Kagane (re-upload site) / Kuaikan"],[351,"WebComics app"]],"chapters":351,"widthMin":800,"widthMax":1280,"pagesAvg":82.4,"words":6097,"tn":0}],"terms":[{"a":"heavenland","b":"tianyong land","countA":8,"countB":6,"how":"aligned","seen":"7/9","driftA":[],"driftB":[]},{"a":"awakened","b":"awakener","countA":11,"countB":5,"how":"stem","seen":"4/11","driftA":[],"driftB":[]}],"onlyA":[{"w":"thousand","n":7,"other":0},{"w":"slimes","n":6,"other":0},{"w":"narlo","n":5,"other":0},{"w":"autumns","n":5,"other":0},{"w":"site","n":5,"other":0}],"onlyB":[{"w":"rumble","n":7,"other":0},{"w":"tiris","n":7,"other":0},{"w":"president","n":6,"other":0},{"w":"daggers","n":5,"other":0}],"secs":0,"votes":{"source":"Comick","a":33695,"b":24724,"pctA":58,"chapters":300,"firstA":300},"skipped":[]}';

describe('tlcompare result', () => {
    it('parses the live 3526 value', () => {
        const result = parseTlCompare(LIVE_3526)!;
        expect(getTlView(result)).toBe('card');
        expect(result.variants.map(({ name, group, tn, widthMin }) => [name, group, tn, widthMin])).toEqual([
            ['unofficial', 'Asura Scans / UTOON (re-upload site) / Manhwa Freak', 3, 201],
            ['official', 'Kuaikan / WebComics app', 0, 800],
        ]);
        expect(result.terms[0]).toEqual({
            a: 'heavenland',
            b: 'tianyong land',
            countA: 8,
            countB: 6,
            how: 'aligned',
            seen: '7/9',
            driftA: [],
            driftB: [],
        });
        expect(result.votes).toEqual({ source: 'Comick', a: 33_695, b: 24_724, pctA: 58, chapters: 300, firstA: 300 });
        // Matched words are no longer among the words only one uses.
        expect(result.onlyA.map(({ w }) => w)).not.toContain('heavenland');
        expect(result.onlyB.map(({ w }) => w)).not.toContain('tianyong');
        expect(result.skipped).toEqual([]);
        expect(result.sampled).toHaveLength(8);
    });

    it('per-chapter groups collapse into runs: ch 1-200 Asura Scans · 251 Manhwa Freak · 301-351 UTOON', () => {
        const [unofficial, official] = parseTlCompare(LIVE_3526)!.variants;
        expect(getGroupRuns(unofficial.groupByCh).map((run) => `${formatRunRange(run)} ${run.name}`)).toEqual([
            '1-200 Asura Scans',
            '251 Manhwa Freak',
            '301-351 UTOON (re-upload site)',
        ]);
        expect(getGroupRuns(official.groupByCh).map((run) => `${formatRunRange(run)} ${run.name}`)).toEqual([
            '1-251 Kuaikan',
            '301 Kagane (re-upload site)',
            '351 WebComics app',
        ]);
        expect(isReuploadSite('UTOON (re-upload site)')).toBe(true);
        expect(isReuploadSite('Kuaikan')).toBe(false);
    });

    it('what the page shows: v1 = stale (Re-check only), error, single upload / anything else = nothing', () => {
        expect(getTlView(parseTlCompare('{"v":1,"status":"ok","variants":[{},{}]}'))).toBe('stale');
        expect(getTlView(parseTlCompare('{"status":"ok","variants":[{},{}]}'))).toBe('stale');
        expect(parseTlCompare('{"v":2,"status":"error","error":"no chapters"}')).toMatchObject({
            error: 'no chapters',
        });
        expect(getTlView(parseTlCompare('{"v":2,"status":"error","error":"no chapters"}'))).toBe('error');
        expect(getTlView(parseTlCompare('{"v":2,"status":"single-upload","variants":[{}]}'))).toBe('none');
        expect(getTlView(parseTlCompare('not json'))).toBe('none');
        expect(getTlView(parseTlCompare(undefined))).toBe('none');
    });

    it('a request is answered by a result at least as new (2 min of clock slack)', () => {
        const result = parseTlCompare(LIVE_3526);
        expect(isRequestAnswered(null, null)).toBe(true);
        expect(isRequestAnswered(1_792_614_700, result)).toBe(true);
        expect(isRequestAnswered(1_792_614_800, result)).toBe(true);
        expect(isRequestAnswered(1_792_615_000, result)).toBe(false);
        expect(isRequestAnswered(1_792_615_000, null)).toBe(false);
        expect(getTlRequestKey(3526)).toBe('tsuji_tlRequest_3526');
    });

    it('scanlators, and which variant the chapter list follows', () => {
        expect(
            getScanlators([{ scanlator: 'official' }, { scanlator: 'unofficial' }, { scanlator: ' official' }, {}]),
        ).toEqual(['official', 'unofficial']);
        const names = ['unofficial', 'official'];
        expect(getActiveVariant(['official'], names)).toBe('unofficial');
        expect(getActiveVariant(['unofficial'], names)).toBe('official');
        expect(getActiveVariant([], names)).toBeNull();
        expect(getActiveVariant(['official', 'unofficial'], names)).toBeNull();
    });

    it('brief #16b: title case, "7/9", who came out first, no votes, skipped chapters', () => {
        expect(toTitleCase('tianyong land')).toBe('Tianyong Land');
        expect(toTitleCase('awakened')).toBe('Awakened');
        expect(toTitleCase('half-elf king')).toBe('Half-Elf King');
        expect(parseSeen('7/9')).toEqual({ matched: 7, total: 9 });
        expect(parseSeen('')).toBeNull();
        expect(getFirstOutSkew({ chapters: 300, firstA: 300 })).toBe('a');
        expect(getFirstOutSkew({ chapters: 300, firstA: 240 })).toBe('a');
        expect(getFirstOutSkew({ chapters: 300, firstA: 150 })).toBeNull();
        expect(getFirstOutSkew({ chapters: 300, firstA: 60 })).toBe('b');
        expect(getFirstOutSkew({ chapters: 0, firstA: 0 })).toBeNull();
        const withoutVotes = parseTlCompare(
            '{"v":2,"status":"ok","votes":null,"skipped":[51,101],"variants":[{},{}]}',
        )!;
        expect(withoutVotes.votes).toBeNull();
        expect(withoutVotes.skipped).toEqual([51, 101]);
        expect(getTlView(withoutVotes)).toBe('card');
    });
});
