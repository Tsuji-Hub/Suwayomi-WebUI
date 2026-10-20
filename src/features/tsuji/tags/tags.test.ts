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
import type { BakaChip, BakaSeries, BakaTag } from '@/features/tsuji/tags/baka.ts';
import { createBakaMerge } from '@/features/tsuji/tags/bakaMerge.ts';
import {
    buildBakaSearch,
    compareBakaSeries,
    getBakaCombinations,
    getMissingDetails,
    getSearchEngine,
    parseBakaSearch,
    parseBakaTags,
    passesAniListChips,
    toBakaCards,
    toBakaMedia,
} from '@/features/tsuji/tags/baka.ts';
import { buildSuggestions, describeChip, normalizeTagKey } from '@/features/tsuji/tags/tagKeys.ts';

const bakaTag = (id: number, name: string, count: number, overrides: Partial<BakaTag> = {}): BakaTag => ({
    id,
    name,
    path: `Settings > Game Elements > ${name}`,
    count,
    isAdult: false,
    isGenre: false,
    ...overrides,
});

const BAKA_SYSTEM = [
    bakaTag(3081, 'System', 316),
    bakaTag(1171, 'Level System', 250),
    bakaTag(1196, 'System Administrator', 273, { path: 'Characters > System Administrator' }),
    bakaTag(13, 'Stat System', 90),
    bakaTag(14, 'System Sidekick', 0),
];

const chip = (name: string, id: number, overrides: Partial<BakaChip> = {}): BakaChip => ({
    state: 'include',
    label: name,
    bakaTags: [{ id, name }],
    ...overrides,
});

describe('tag keys', () => {
    it('normalizes names from both sources to one key', () => {
        expect(normalizeTagKey('Dungeons')).toBe('dungeon');
        expect(normalizeTagKey('Dungeon')).toBe('dungeon');
        expect(normalizeTagKey('Martial Arts')).toBe('martial art');
        expect(normalizeTagKey('Boss')).toBe('boss');
        expect(normalizeTagKey('Isekai!')).toBe('isekai');
    });
});

describe('suggestions', () => {
    const genres = ['Action', 'Fantasy', 'Hentai'];
    const tags = [{ name: 'Dungeon' }, { name: 'Martial Arts' }, { name: 'Sexual Content', isAdult: true }];

    it('"system": the System family first (System + Level System + System Administrator), the tags on their own too', () => {
        const suggestions = buildSuggestions({
            query: 'system',
            genres,
            tags,
            bakaTags: BAKA_SYSTEM,
            showAdult: false,
        });
        expect(suggestions.map(({ label, isTagOnly }) => (isTagOnly ? `${label} only` : label))).toEqual([
            'System',
            'System only',
            'System Administrator',
            'Level System',
            'Stat System',
        ]);
        expect(suggestions[0]).toMatchObject({ key: 'system', isFamily: true, count: 316 + 250 + 273 });
        expect(suggestions[0].bakaTags?.map(({ id }) => id)).toEqual([3081, 1171, 1196]);
        expect(describeChip(suggestions[0])).toBe('System, Level System (+4), System Administrator');
        expect(suggestions[1]).toMatchObject({ bakaTags: [{ id: 3081, name: 'System' }], count: 316 });
        expect(describeChip(suggestions[1])).toBe('MangaBaka Settings > Game Elements > System');
    });

    it('a family merges with the AniList tag of the same name; "regress" offers the Regression family', () => {
        const [dungeon] = buildSuggestions({
            query: 'dungeon',
            genres,
            tags,
            bakaTags: [bakaTag(500, 'Dungeon', 836), bakaTag(2103, 'Dungeon Exploring', 146)],
            showAdult: false,
        });
        expect(dungeon).toMatchObject({ key: 'dungeon', tag: 'Dungeon', isFamily: true, count: 982 });
        const [regression] = buildSuggestions({ query: 'regress', genres, tags, bakaTags: [], showAdult: false });
        expect(regression.bakaTags?.map(({ id }) => id)).toEqual([3495, 2461, 2147, 5101]);
    });

    it('merges AniList "Martial Arts" and MangaBaka "Martial Arts" into one chip backed by both', () => {
        const [martialArts, ...rest] = buildSuggestions({
            query: 'martial',
            genres,
            tags,
            bakaTags: [bakaTag(29, 'Martial Arts', 5484, { path: 'Theme > Martial Arts' })],
            showAdult: false,
        });
        expect(rest).toEqual([]);
        expect(martialArts).toEqual({
            key: 'martial art',
            label: 'Martial Arts',
            tag: 'Martial Arts',
            bakaTags: [{ id: 29, name: 'Martial Arts' }],
            count: 5484,
            path: 'Theme > Martial Arts',
        });
        expect(describeChip(martialArts)).toBe('MangaBaka Theme > Martial Arts; AniList tag Martial Arts');
    });

    it('AniList-only names stay AniList-only; adult tags and Hentai need the Adult filter', () => {
        expect(buildSuggestions({ query: 'fanta', genres, tags, bakaTags: [], showAdult: false })).toEqual([
            { key: 'fantasy', label: 'Fantasy', genre: 'Fantasy' },
        ]);
        expect(buildSuggestions({ query: 'sexual', genres, tags, bakaTags: [], showAdult: false })).toEqual([]);
        expect(buildSuggestions({ query: 'hent', genres, tags, bakaTags: [], showAdult: true })).toHaveLength(1);
        const adultTag = [bakaTag(30, 'Netorare', 40, { isAdult: true })];
        expect(buildSuggestions({ query: 'netor', genres, tags, bakaTags: adultTag, showAdult: false })).toEqual([]);
        expect(buildSuggestions({ query: 'netor', genres, tags, bakaTags: adultTag, showAdult: true })).toHaveLength(1);
    });

    it('parses /v1/tags rows', () => {
        expect(
            parseBakaTags({
                data: [
                    {
                        id: 3081,
                        name: 'System',
                        name_path: 'Settings > Game Elements > System',
                        series_count: 316,
                        content_rating: 'safe',
                        is_genre: false,
                    },
                    { id: 'x', name: 'Broken' },
                ],
            }),
        ).toEqual([BAKA_SYSTEM[0]]);
    });
});

describe('search engine', () => {
    it('AniList unless a selected chip has nothing on AniList', () => {
        expect(getSearchEngine(undefined)).toBe('anilist');
        expect(getSearchEngine({ dungeon: chip('Dungeon', 20, { tag: 'Dungeon' }) })).toBe('anilist');
        expect(getSearchEngine({ system: chip('System', 11) })).toBe('baka');
        expect(getSearchEngine({ system: chip('System', 11, { state: 'exclude' }) })).toBe('baka');
    });

    it('merged chips search AniList by their AniList name; MangaBaka-only chips count as a selection', () => {
        const selection = {
            genres: {},
            tags: { Revenge: 'include' as const },
            baka: { dungeon: chip('Dungeon', 20, { tag: 'Dungeon' }) },
        };
        expect(buildDiscoverVariables(selection, DEFAULT_REC_FILTERS)).toEqual({ tagIn: ['Dungeon', 'Revenge'] });
        expect(getIncludedTags(selection)).toEqual(['Dungeon', 'Revenge']);
        expect(hasSelection({ genres: {}, tags: {}, baka: { system: chip('System', 11) } })).toBe(true);
    });
});

describe('MangaBaka search', () => {
    it('tag ids only (AND), excluded ids, types OR, adult only when allowed, most popular first', () => {
        const query = buildBakaSearch({
            tagIds: [3081, 29],
            excludeIds: [99],
            types: ['MANHWA', 'MANHUA'],
            sort: 'POPULARITY',
            minScore: 0,
            showAdult: false,
            page: 2,
            limit: 50,
        });
        const params = new URLSearchParams(query);
        expect(params.getAll('tag')).toEqual(['29', '3081']);
        expect([...params.getAll('tag'), ...params.getAll('tag_not')].every((value) => /^\d+$/.test(value))).toBe(true);
        expect(params.getAll('tag_not')).toEqual(['99']);
        expect(params.getAll('type')).toEqual(['manhua', 'manhwa']);
        expect(params.getAll('content_rating')).toEqual(['safe', 'suggestive']);
        expect(params.get('sort_by')).toBe('popularity_asc');
        expect(params.get('rating_lower')).toBeNull();
        expect([params.get('page'), params.get('limit')]).toEqual(['2', '50']);
    });

    it('no Type filter = comics only; adult on = every rating; score sort and minimum score', () => {
        const params = new URLSearchParams(
            buildBakaSearch({
                tagIds: [3081],
                excludeIds: [],
                types: [],
                sort: 'SCORE',
                minScore: 70,
                showAdult: true,
                page: 1,
                limit: 50,
            }),
        );
        expect(params.getAll('type')).toEqual(['manga', 'manhua', 'manhwa']);
        expect(params.getAll('content_rating')).toEqual(['safe', 'suggestive', 'erotica', 'pornographic']);
        expect(params.get('sort_by')).toBe('score_desc');
        expect(params.get('rating_lower')).toBe('70');
    });

    it('one sub-search per combination: OR inside a chip, AND across chips, capped at 16', () => {
        expect(getBakaCombinations([[3081, 1171, 1196], [29]])).toEqual([
            [29, 3081],
            [29, 1171],
            [29, 1196],
        ]);
        expect(
            getBakaCombinations([
                [3081, 1171, 1196],
                [3495, 2461, 2147, 5101],
            ]),
        ).toHaveLength(12);
        expect(getBakaCombinations([])).toEqual([[]]);
        expect(getBakaCombinations([[1, 2], [2]])).toEqual([[1, 2], [2]]);
        expect(
            getBakaCombinations([
                [1, 2, 3, 4, 5],
                [6, 7, 8, 9],
            ]),
        ).toHaveLength(16);
    });
});

const SOLO_ROW = {
    id: 1,
    title: 'Solo Leveling',
    titles: [
        { language: 'en', title: 'Solo Leveling', is_primary: true, traits: ['official'] },
        { language: 'ko-Latn', title: 'Na Honjaman Level-Up', is_primary: false, traits: [] },
    ],
    cover: { x250: { x1: 'https://cdn.mangabaka.org/1.jpg' } },
    type: 'manhwa',
    status: 'completed',
    rating: 88.4,
    popularity: { global: { current: 7, previous: 8 } },
    total_chapters: '201',
    content_rating: 'safe',
    year: 2018,
    source: { anilist: { id: 105398 }, my_anime_list: { id: 121496 }, manga_updates: { id: 'abc' } },
};

const series = (id: number, anilistId: number | null, overrides: Partial<BakaSeries> = {}): BakaSeries => ({
    id,
    anilistId,
    malId: null,
    title: `Series ${id}`,
    english: null,
    romaji: null,
    cover: null,
    type: 'manhwa',
    status: 'releasing',
    rating: 80,
    popularity: id,
    totalChapters: 100,
    isAdult: false,
    year: 2020,
    ...overrides,
});

describe('MangaBaka series', () => {
    it('parses a search page into small series with their AniList / MAL ids', () => {
        const page = parseBakaSearch({ data: [SOLO_ROW, { nope: true }], pagination: { next: '?page=2' } }, 50);
        expect(page.hasNextPage).toBe(true);
        expect(page.series).toEqual([
            {
                id: 1,
                anilistId: 105398,
                malId: 121496,
                title: 'Solo Leveling',
                english: 'Solo Leveling',
                romaji: 'Na Honjaman Level-Up',
                cover: 'https://cdn.mangabaka.org/1.jpg',
                type: 'manhwa',
                status: 'completed',
                rating: 88.4,
                popularity: 7,
                totalChapters: 201,
                isAdult: false,
                year: 2018,
            },
        ]);
        expect(parseBakaSearch({ data: [SOLO_ROW] }, 50).hasNextPage).toBe(false);
    });

    it('cards key on the AniList id (negative MangaBaka id without one); MangaBaka chapters and rating stay', () => {
        const [solo] = parseBakaSearch({ data: [SOLO_ROW] }, 50).series;
        expect(toBakaMedia(solo)).toMatchObject({
            id: 105398,
            idMal: 121496,
            countryOfOrigin: 'KR',
            status: 'FINISHED',
            chapters: 201,
            averageScore: 88,
            coverImage: { large: 'https://cdn.mangabaka.org/1.jpg' },
        });
        expect(toBakaMedia(series(7, null)).id).toBe(-7);
        const details = { id: 105398, chapters: null, averageScore: 84, description: 'AniList synopsis' } as RecMedia;
        expect(toBakaMedia(solo, details)).toMatchObject({
            description: 'AniList synopsis',
            chapters: 201,
            averageScore: 88,
        });
    });

    it('cards show before details; AniList-only chips filter once details are in; one card per id', () => {
        const pages = [[series(1, 10), series(2, 20), series(3, null)], [series(4, 10)]];
        const noChips = { genres: {}, tags: {} };
        expect(toBakaCards(pages, new Map(), noChips).map((page) => page.map(({ id }) => id))).toEqual([
            [10, 20, -3],
            [],
        ]);
        const details = new Map<number, RecMedia | null>([
            [10, { id: 10, genres: [], tags: [{ name: 'Revenge', rank: 90 }] } as unknown as RecMedia],
            [20, null],
        ]);
        const revenge = { genres: {}, tags: { Revenge: 'include' as const } };
        expect(toBakaCards(pages, details, revenge).map((page) => page.map(({ id }) => id))).toEqual([[10], []]);
        expect(getMissingDetails(pages[0], new Map([[10, null]]))).toEqual([20]);
    });

    it('AniList-only chips: included tags need rank >= 60, excluded tags any rank, genres as they are', () => {
        const media = {
            id: 1,
            genres: ['Action'],
            tags: [
                { name: 'Martial Arts', rank: 80 },
                { name: 'Revenge', rank: 40 },
            ],
        } as RecMedia;
        expect(passesAniListChips(media, { genres: {}, tags: { 'Martial Arts': 'include' } })).toBe(true);
        expect(passesAniListChips(media, { genres: {}, tags: { Revenge: 'include' } })).toBe(false);
        expect(passesAniListChips(media, { genres: {}, tags: { Revenge: 'exclude' } })).toBe(false);
        expect(passesAniListChips(media, { genres: { Romance: 'include' }, tags: {} })).toBe(false);
        expect(passesAniListChips(null, { genres: {}, tags: { Revenge: 'exclude' } })).toBe(true);
        expect(passesAniListChips(null, { genres: {}, tags: { Revenge: 'include' } })).toBe(false);
    });
});

const pagesOf = (rows: BakaSeries[], size: number) =>
    Array.from({ length: Math.ceil(rows.length / size) }, (_, index) => rows.slice(index * size, (index + 1) * size));

describe('merging sub-searches', () => {
    const ranked = (id: number, popularity: number) => series(id, null, { popularity });

    it('k-way merge by rank, no repeats, a source fetched only when its rows run out, nothing skipped', async () => {
        const sources = [
            pagesOf([ranked(1, 1), ranked(3, 3), ranked(5, 5), ranked(7, 7), ranked(9, 9)], 2),
            pagesOf([ranked(2, 2), ranked(3, 3), ranked(4, 4), ranked(10, 10)], 2),
        ];
        const fetched: string[] = [];
        const merge = createBakaMerge({
            sourceCount: 2,
            compare: compareBakaSeries('POPULARITY'),
            fetchPage: async (source, page) => {
                fetched.push(`${source}:${page}`);
                return { series: sources[source][page - 1] ?? [], hasNextPage: page < sources[source].length };
            },
        });
        expect((await merge.next(3)).map(({ id }) => id)).toEqual([1, 2, 3]);
        expect(fetched).toEqual(['0:1', '1:1']);
        expect((await merge.next(3)).map(({ id }) => id)).toEqual([4, 5, 7]);
        expect((await merge.next(10)).map(({ id }) => id)).toEqual([9, 10]);
        expect(merge.hasNext()).toBe(false);
        expect(fetched).toEqual(['0:1', '1:1', '0:2', '1:2', '0:3']);
    });

    it('a failed page consumes nothing: the retry continues exactly where it stopped', async () => {
        let isDown = false;
        const merge = createBakaMerge({
            sourceCount: 1,
            compare: compareBakaSeries('POPULARITY'),
            fetchPage: async (_source, page) => {
                if (isDown) {
                    throw new Error('429');
                }
                return {
                    series: [ranked(page * 2 - 1, page * 2 - 1), ranked(page * 2, page * 2)],
                    hasNextPage: page < 3,
                };
            },
        });
        expect((await merge.next(2)).map(({ id }) => id)).toEqual([1, 2]);
        isDown = true;
        await expect(merge.next(3)).rejects.toThrow('429');
        isDown = false;
        expect((await merge.next(3)).map(({ id }) => id)).toEqual([3, 4, 5]);
    });

    it('score and newest order; unknown values last', () => {
        const byScore = [
            series(1, null, { rating: null }),
            series(2, null, { rating: 90 }),
            series(3, null, { rating: 70 }),
        ];
        expect([...byScore].sort(compareBakaSeries('SCORE')).map(({ id }) => id)).toEqual([2, 3, 1]);
        const byYear = [
            series(1, null, { year: 2010 }),
            series(2, null, { year: null }),
            series(3, null, { year: 2024 }),
        ];
        expect([...byYear].sort(compareBakaSeries('NEWEST')).map(({ id }) => id)).toEqual([3, 1, 2]);
    });
});
