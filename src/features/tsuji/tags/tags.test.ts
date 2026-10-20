/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import { buildDiscoverVariables, getIncludedTags, hasSelection } from '@/features/tsuji/discover/discoverQuery.ts';
import { DEFAULT_REC_FILTERS } from '@/features/tsuji/recs/filters.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { AniListCandidate, MuSeries } from '@/features/tsuji/tags/muSearch.ts';
import {
    buildMuQueries,
    getSearchEngine,
    mergeMuSeries,
    parseMuCategorySearch,
    parseMuSeriesSearch,
    passesAniListChips,
    pickAniListMatch,
    splitAniListChips,
    toMuCards,
    toMuGenre,
    toUnmatchedMedia,
} from '@/features/tsuji/tags/muSearch.ts';
import { buildMatchQuery } from '@/features/tsuji/tags/muQueries.ts';
import { buildSuggestions, describeChip, normalizeTagKey } from '@/features/tsuji/tags/tagKeys.ts';

const MU_SYSTEM = [
    { category: 'System', usage: 602 },
    { category: 'Level System', usage: 427 },
    { category: 'Stat System', usage: 46 },
    { category: 'System Admin', usage: 3 },
];

describe('tag keys', () => {
    it('normalizes MU and AniList names to one key', () => {
        expect(normalizeTagKey('Dungeon/s')).toBe('dungeon');
        expect(normalizeTagKey('Dungeon')).toBe('dungeon');
        expect(normalizeTagKey('Special Ability/ies')).toBe('special ability');
        expect(normalizeTagKey('Martial Arts')).toBe('martial art');
        expect(normalizeTagKey('Boss')).toBe('boss');
        expect(normalizeTagKey('Isekai!')).toBe('isekai');
    });
});

describe('suggestions', () => {
    const genres = ['Action', 'Fantasy', 'Hentai'];
    const tags = [{ name: 'Dungeon' }, { name: 'Martial Arts' }, { name: 'Sexual Content', isAdult: true }];

    it('"system" is one System chip (alias of three MU categories) plus the other MU system categories', () => {
        const suggestions = buildSuggestions({
            query: 'system',
            genres,
            tags,
            muCategories: MU_SYSTEM,
            showAdult: false,
        });
        const systemChips = suggestions.filter(({ label }) => label === 'System');
        expect(systemChips).toHaveLength(1);
        expect(systemChips[0]).toMatchObject({
            key: 'system',
            categories: ['System', 'Level System', 'Stat System'],
            count: 602,
        });
        expect(suggestions.map(({ label }) => label)).toEqual(['System', 'Level System', 'Stat System']);
        expect(describeChip(systemChips[0])).toBe('includes: MangaUpdates: System, Level System, Stat System');
    });

    it('merges AniList "Dungeon" and MU "Dungeon/s" into one chip backed by both', () => {
        const [dungeon, ...rest] = buildSuggestions({
            query: 'dungeon',
            genres,
            tags,
            muCategories: [{ category: 'Dungeon/s', usage: 586 }],
            showAdult: false,
        });
        expect(rest).toEqual([]);
        expect(dungeon).toEqual({
            key: 'dungeon',
            label: 'Dungeon',
            tag: 'Dungeon',
            categories: ['Dungeon/s'],
            count: 586,
        });
    });

    it('AniList-only names stay AniList-only; adult tags and Hentai need the Adult filter; MU noise is dropped', () => {
        expect(buildSuggestions({ query: 'fanta', genres, tags, muCategories: [], showAdult: false })).toEqual([
            { key: 'fantasy', label: 'Fantasy', genre: 'Fantasy', categories: [] },
        ]);
        expect(buildSuggestions({ query: 'sexual', genres, tags, muCategories: [], showAdult: false })).toEqual([]);
        expect(buildSuggestions({ query: 'hent', genres, tags, muCategories: [], showAdult: true })).toHaveLength(1);
        expect(buildSuggestions({ query: 'admin', genres, tags, muCategories: MU_SYSTEM, showAdult: false })).toEqual(
            [],
        );
    });

    it('aliases: litrpg and regression', () => {
        expect(
            buildSuggestions({ query: 'litrpg', genres, tags, muCategories: [], showAdult: false })[0],
        ).toMatchObject({
            label: 'LitRPG',
            categories: ['Game Elements', 'Level System'],
        });
        expect(
            buildSuggestions({
                query: 'regress',
                genres,
                tags,
                muCategories: [{ category: 'Regression', usage: 599 }],
                showAdult: false,
            }),
        ).toEqual([{ key: 'regression', label: 'Regression', categories: ['Regression'], count: 599 }]);
    });
});

describe('search engine', () => {
    it('AniList unless a selected chip has nothing on AniList', () => {
        expect(getSearchEngine(undefined)).toBe('anilist');
        expect(
            getSearchEngine({
                dungeon: { state: 'include', label: 'Dungeon', tag: 'Dungeon', categories: ['Dungeon/s'] },
            }),
        ).toBe('anilist');
        expect(getSearchEngine({ system: { state: 'include', label: 'System', categories: ['System'] } })).toBe('mu');
        expect(getSearchEngine({ system: { state: 'exclude', label: 'System', categories: ['System'] } })).toBe('mu');
    });

    it('merged chips search AniList by their AniList name; MU-only chips count as a selection', () => {
        const selection = {
            genres: {},
            tags: { Revenge: 'include' as const },
            mu: { dungeon: { state: 'include' as const, label: 'Dungeon', tag: 'Dungeon', categories: ['Dungeon/s'] } },
        };
        expect(buildDiscoverVariables(selection, DEFAULT_REC_FILTERS)).toEqual({ tagIn: ['Dungeon', 'Revenge'] });
        expect(getIncludedTags(selection)).toEqual(['Dungeon', 'Revenge']);
        expect(
            hasSelection({
                genres: {},
                tags: {},
                mu: { system: { state: 'include', label: 'S', categories: ['System'] } },
            }),
        ).toBe(true);
    });
});

describe('MU queries', () => {
    const system = {
        state: 'include' as const,
        label: 'System',
        categories: ['System', 'Level System', 'Stat System'],
    };

    it('one query per category of a chip (OR), chips combined (AND), adult genres excluded, comics only', () => {
        const queries = buildMuQueries({
            mu: { system, martial: { state: 'include', label: 'Martial Arts', categories: ['Martial Arts'] } },
            types: ['MANHWA'],
            sort: 'BEST',
            showAdult: false,
            page: 2,
        });
        expect(queries.map(({ category }) => category)).toEqual([
            ['System', 'Martial Arts'],
            ['Level System', 'Martial Arts'],
            ['Stat System', 'Martial Arts'],
        ]);
        expect(queries[0]).toEqual({
            category: ['System', 'Martial Arts'],
            exclude_genre: ['Adult', 'Hentai', 'Smut'],
            type: ['Manhwa'],
            orderby: 'rating',
            page: 2,
            perpage: 50,
        });
    });

    it('excluded chips, all types, adult allowed, newest first; capped at 6 queries', () => {
        const [query] = buildMuQueries({
            mu: { system, harem: { state: 'exclude', label: 'Harem', categories: ['Harem'] } },
            types: [],
            sort: 'NEWEST',
            showAdult: true,
            page: 1,
        });
        expect(query).toEqual({
            category: ['System'],
            exclude_category: ['Harem'],
            type: ['Manhwa', 'Manhua', 'Manga'],
            orderby: 'year',
            page: 1,
            perpage: 50,
        });
        const many = buildMuQueries({
            mu: { a: system, b: { ...system, label: 'B' } },
            types: [],
            sort: 'BEST',
            showAdult: false,
            page: 1,
        });
        expect(many).toHaveLength(6);
    });
});

describe('MU responses', () => {
    it('parses series and categories, merges by series id', () => {
        const { total, series } = parseMuSeriesSearch({
            total_hits: 211,
            results: [
                {
                    record: {
                        series_id: 1,
                        title: 'Solo Leveling',
                        url: 'https://mu/s/1',
                        image: { url: { original: 'https://img/1.jpg', thumb: 'https://img/1t.jpg' } },
                        type: 'Manhwa',
                        year: '2018',
                        bayesian_rating: 8.4,
                    },
                },
                { record: { title: 'no id' } },
            ],
        });
        expect(total).toBe(211);
        expect(series).toEqual([
            {
                seriesId: 1,
                title: 'Solo Leveling',
                url: 'https://mu/s/1',
                image: 'https://img/1.jpg',
                type: 'Manhwa',
                year: 2018,
                rating: 8.4,
            },
        ]);
        expect(parseMuCategorySearch({ results: [{ record: { category: 'System', usage: 602 } }, {}] })).toEqual([
            { category: 'System', usage: 602 },
        ]);
        expect(
            mergeMuSeries([[series[0]], [series[0], { ...series[0], seriesId: 2 }]]).map(({ seriesId }) => seriesId),
        ).toEqual([1, 2]);
    });
});

const candidate = (overrides: Partial<AniListCandidate>): AniListCandidate =>
    ({
        id: 1,
        title: { romaji: null, english: null, native: null, userPreferred: null },
        synonyms: [],
        countryOfOrigin: 'KR',
        startDate: { year: 2018, month: null, day: null },
        isAdult: false,
        tags: [],
        ...overrides,
    }) as AniListCandidate;

const muSeries = (title: string, overrides: Partial<MuSeries> = {}): MuSeries => ({
    seriesId: 9,
    title,
    url: '',
    image: null,
    type: 'Manhwa',
    year: 2018,
    rating: null,
    ...overrides,
});

describe('matching MU series to AniList', () => {
    it('accepts an exact normalized name among all names (synonyms too)', () => {
        const other = candidate({
            id: 2,
            title: { romaji: 'Something', english: null, native: null, userPreferred: null },
        });
        const match = candidate({ id: 3, synonyms: ['Pick Me Up, Infinite Gacha'] });
        expect(pickAniListMatch(muSeries('Pick Me Up, Infinite Gacha'), [other, match])?.id).toBe(3);
    });

    it('otherwise only a very close top hit from the same country and year (+-1)', () => {
        const top = candidate({
            id: 4,
            title: { romaji: 'Solo Levelling', english: null, native: null, userPreferred: null },
        });
        expect(pickAniListMatch(muSeries('Solo Leveling'), [top])?.id).toBe(4);
        expect(pickAniListMatch(muSeries('Solo Leveling', { type: 'Manga' }), [top])).toBeNull();
        expect(pickAniListMatch(muSeries('Solo Leveling', { year: 2015 }), [top])).toBeNull();
        expect(pickAniListMatch(muSeries('Solo Hunter'), [top])).toBeNull();
        expect(pickAniListMatch(muSeries('Anything'), [])).toBeNull();
    });

    it("colliding exact names: the MU type's country wins, then the year; another country alone is no match", () => {
        const gekkaBijin = candidate({
            id: 94792,
            countryOfOrigin: 'JP',
            startDate: { year: 2008, month: null, day: null },
            title: { romaji: 'Gekka Bijin', english: null, native: null, userPreferred: null },
            synonyms: ['Pick Me Up'],
        });
        const pickMeUp = candidate({
            id: 159441,
            startDate: { year: 2022, month: null, day: null },
            title: { romaji: 'Pick Me Up!', english: null, native: null, userPreferred: null },
        });
        const oldNamesake = candidate({
            id: 5,
            startDate: { year: 2010, month: null, day: null },
            title: { romaji: 'Pick Me Up!', english: null, native: null, userPreferred: null },
        });
        const series = muSeries('Pick Me Up!', { year: 2022 });
        expect(pickAniListMatch(series, [gekkaBijin, pickMeUp])?.id).toBe(159441);
        expect(pickAniListMatch(series, [oldNamesake, gekkaBijin, pickMeUp])?.id).toBe(159441);
        expect(pickAniListMatch(series, [gekkaBijin])).toBeNull();
    });

    it('builds one aliased request for up to 10 titles', () => {
        const query = buildMatchQuery(3);
        expect(query).toContain('$t0: String, $t1: String, $t2: String');
        expect(query).toContain('m2: Page(perPage: 3) { media(search: $t2, type: MANGA)');
        expect(query).not.toContain('m3:');
    });
});

describe('AniList-only chips in an MU search', () => {
    const media = {
        id: 1,
        genres: ['Action'],
        tags: [
            { name: 'Martial Arts', rank: 80 },
            { name: 'Revenge', rank: 40 },
        ],
    } as RecMedia;

    it('included tags need rank >= 60, excluded tags any rank, genres as they are', () => {
        expect(passesAniListChips(media, { genres: {}, tags: { 'Martial Arts': 'include' } })).toBe(true);
        expect(passesAniListChips(media, { genres: {}, tags: { Revenge: 'include' } })).toBe(false);
        expect(passesAniListChips(media, { genres: {}, tags: { Revenge: 'exclude' } })).toBe(false);
        expect(passesAniListChips(media, { genres: { Action: 'include' }, tags: {} })).toBe(true);
        expect(passesAniListChips(media, { genres: { Romance: 'include' }, tags: {} })).toBe(false);
    });

    it('unmatched cards drop out only when such a chip is included', () => {
        expect(passesAniListChips(null, { genres: {}, tags: {} })).toBe(true);
        expect(passesAniListChips(null, { genres: {}, tags: { Revenge: 'exclude' } })).toBe(true);
        expect(passesAniListChips(null, { genres: {}, tags: { 'Martial Arts': 'include' } })).toBe(false);
    });

    it('unmatched MU series become cards with a negative id (no list state)', () => {
        expect(
            toUnmatchedMedia(muSeries('Raw Only', { seriesId: 77, rating: 7.25, image: 'https://img' })),
        ).toMatchObject({
            id: -77,
            title: { userPreferred: 'Raw Only' },
            coverImage: { large: 'https://img' },
            averageScore: 73,
            countryOfOrigin: 'KR',
        });
    });
});

describe('MU genres from AniList chips', () => {
    it('chips MU knows as genres go server side, the rest stay a post-filter', () => {
        expect(toMuGenre('Sci-Fi')).toBe('Sci-fi');
        expect(toMuGenre('Martial Arts')).toBe('Martial Arts');
        expect(toMuGenre('Revenge')).toBeNull();
        const { muGenres, postFilter } = splitAniListChips({
            genres: { Romance: 'exclude' },
            tags: { 'Martial Arts': 'include', Revenge: 'include' },
        });
        expect(muGenres).toEqual({ include: ['Martial Arts'], exclude: ['Romance'] });
        expect(postFilter).toEqual({ genres: {}, tags: { Revenge: 'include' } });
        const [query] = buildMuQueries({
            mu: { system: { state: 'include', label: 'System', categories: ['System'] } },
            muGenres,
            types: ['MANHWA'],
            sort: 'SCORE',
            showAdult: false,
            page: 1,
        });
        expect(query).toMatchObject({
            category: ['System'],
            genre: ['Martial Arts'],
            exclude_genre: ['Romance', 'Adult', 'Hentai', 'Smut'],
            type: ['Manhwa'],
        });
    });
});

describe('MU cards while matches land', () => {
    const first = muSeries('First', { seriesId: 1 });
    const second = muSeries('Second', { seriesId: 2 });
    const third = muSeries('Third', { seriesId: 3 });
    const matched = {
        id: 50,
        genres: [],
        tags: [{ name: 'Revenge', rank: 90 }],
        isAdult: false,
    } as unknown as RecMedia;
    const noChips = { postFilter: { genres: {}, tags: {} }, showAdult: false };

    it('cards show before any match, as MU cards', () => {
        expect(toMuCards([[first, second]], new Map(), noChips)[0].map(({ id }) => id)).toEqual([-1, -2]);
    });

    it('matches replace their cards; filters apply once a verdict is in; one card per AniList id', () => {
        const matches = new Map<number, RecMedia | null>([
            [1, matched],
            [2, null],
            [3, matched],
        ]);
        expect(toMuCards([[first, second], [third]], matches, noChips).map((page) => page.map(({ id }) => id))).toEqual(
            [[50, -2], []],
        );
        const revenge = { postFilter: { genres: {}, tags: { Revenge: 'include' as const } }, showAdult: false };
        expect(toMuCards([[first, second]], matches, revenge)[0].map(({ id }) => id)).toEqual([50]);
        const adult = new Map<number, RecMedia | null>([[1, { ...matched, isAdult: true }]]);
        expect(toMuCards([[first, second]], adult, noChips)[0].map(({ id }) => id)).toEqual([-2]);
    });
});
