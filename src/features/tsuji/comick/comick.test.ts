/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it, vi } from 'vitest';
vi.mock('@/features/tsuji/services/TsujiCache.ts', () => ({
    TsujiCache: { get: () => null, set: () => {}, remove: () => {} },
}));

const {
    buildComickSearch,
    getComickAniListId,
    parseComickComic,
    parseComickGenres,
    parseComickSearch,
    titleFromSlug,
    toComickMedia,
} = await import('@/features/tsuji/comick/comickCatalog.ts');
const { adoptListIds } = await import('@/features/tsuji/comick/listMatch.ts');
const { getComickExtras } = await import('@/features/tsuji/comick/comickExtras.ts');
const { parseListTitleIndex } = await import('@/features/tsuji/seen/myList.ts');
const { mergeComickBestMatches } = await import('@/features/tsuji/forYou/comickWeek.ts');

const hit = (id: number, overrides: Record<string, unknown> = {}) => ({
    id,
    hid: `h${id}`,
    slug: `comick-${id}`,
    title: `Comick ${id}`,
    country: 'kr',
    status: 1,
    last_chapter: 120.5,
    year: 2021,
    genres: [1, 2],
    content_rating: 'safe',
    bayesian_rating: '8.12',
    user_follow_count: 54_321,
    md_covers: [{ b2key: 'abc.jpg' }],
    md_titles: [{ title: `Alt ${id}` }],
    ...overrides,
});

const genres = parseComickGenres([
    { id: 1, name: 'Action', slug: 'action' },
    { id: 2, name: 'Regression', slug: 'regression' },
    { name: 'broken' },
]);

describe('Comick cards', () => {
    it('score = bayesian x 10, popularity = follows, status / year / chapters, tags from genres', () => {
        expect(toComickMedia(hit(7), genres)).toMatchObject({
            id: -1_000_000_007,
            averageScore: 81,
            popularity: 54_321,
            status: 'RELEASING',
            chapters: 120,
            countryOfOrigin: 'KR',
            startDate: { year: 2021 },
            isAdult: false,
            coverImage: { large: 'https://meo.comick.pictures/abc.jpg' },
            title: { english: 'Comick 7', romaji: 'Alt 7' },
            via: 'comick',
        });
        expect(toComickMedia(hit(7), genres)?.tags?.map(({ name }) => name)).toEqual(['Action', 'Regression']);
    });

    it('keyed on links.al when Comick has it; erotica / pornographic are adult; tags from the comic page too', () => {
        const comic = toComickMedia(
            hit(8, {
                links: { al: '119257', mal: '123' },
                content_rating: 'erotica',
                md_comic_md_genres: [{ md_genres: { name: 'Fantasy' } }],
                mu_comic_categories: [{ mu_categories: { title: 'Weak to Strong' } }],
                genres: [],
            }),
        );
        expect(comic).toMatchObject({ id: 119_257, idMal: 123, isAdult: true });
        expect(comic?.tags?.map(({ name }) => name)).toEqual(['Fantasy', 'Weak to Strong']);
        expect(toComickMedia({ title: 'no id' })).toBeNull();
    });

    it('search rows: AniList id from external_ids, latest chapter date from uploaded_at, Comick score flag', () => {
        const row = hit(9, {
            external_ids: { anilist: '133070', mangabaka: '1' },
            uploaded_at: '2025-03-01T00:00:00Z',
        });
        expect(getComickAniListId(row)).toBe(133_070);
        expect(toComickMedia(row)).toMatchObject({
            id: 133_070,
            lastChapterAt: Date.parse('2025-03-01T00:00:00Z'),
            scoreSource: 'comick',
        });
        expect(toComickMedia(hit(10))).toMatchObject({ lastChapterAt: null });
        expect(getComickAniListId({ links: { al: '5' }, external_ids: { anilist: '6' } })).toBe(5);
        expect(getComickAniListId({ external_ids: {} })).toBeNull();
    });

    it("the English title: an alternative close to the slug, else the slug, else Comick's (kept as an alternative)", () => {
        const solo = toComickMedia(
            hit(1, {
                title: 'I am the only the one who levels up',
                slug: 'solo-leveling',
                md_titles: [
                    { title: 'Na Honjaman Level Up', lang: 'ko-ro' },
                    { title: 'Solo Leveling', lang: 'en' },
                ],
            }),
        );
        expect(solo?.title).toEqual({
            english: 'Solo Leveling',
            userPreferred: 'Solo Leveling',
            romaji: 'I am the only the one who levels up',
        });
        const orv = toComickMedia(
            hit(2, {
                title: 'ORV',
                slug: '00-omniscient-readers-viewpoint',
                md_titles: [{ title: "Omniscient Reader's Viewpoint", lang: 'en' }],
            }),
        );
        expect(orv?.title?.english).toBe("Omniscient Reader's Viewpoint");
        expect(
            toComickMedia(hit(3, { title: 'ORV', slug: 'omniscient-readers-viewpoint', md_titles: [] }))?.title
                ?.english,
        ).toBe('Omniscient Readers Viewpoint');
        expect(titleFromSlug('x')).toBeNull();
    });

    it('a search page, each comic once', () =>
        expect(parseComickSearch([hit(1), hit(1), hit(2)], genres).map(({ id }) => id)).toEqual([
            -1_000_000_001, -1_000_000_002,
        ]));

    it("Discover's filters Comick applies: sort, countries, one status, minimum chapters", () => {
        const query = new URLSearchParams(
            buildComickSearch({
                sort: 'TRENDING',
                types: ['MANHWA', 'MANHUA'],
                statuses: ['FINISHED'],
                minChapters: 50,
                page: 2,
                limit: 100,
            }),
        );
        expect(query.get('sort')).toBe('view');
        expect(query.getAll('country')).toEqual(['cn', 'kr']);
        expect(query.get('status')).toBe('2');
        expect(query.get('minimum')).toBe('50');
        expect(query.get('page')).toBe('2');
        const popular = new URLSearchParams(
            buildComickSearch({
                sort: 'POPULARITY',
                types: [],
                statuses: ['FINISHED', 'RELEASING'],
                minChapters: 0,
                page: 1,
                limit: 100,
            }),
        );
        expect(popular.get('sort')).toBe('follow');
        expect(popular.getAll('country')).toEqual(['cn', 'jp', 'kr']);
        expect(popular.get('status')).toBeNull();
        expect(popular.get('minimum')).toBeNull();
        expect(
            new URLSearchParams(
                buildComickSearch({ sort: 'SCORE', types: [], statuses: [], minChapters: 0, page: 1, limit: 1 }),
            ).get('sort'),
        ).toBe('rating');
    });

    it("a recommendation with only a title and a slug gets the slug's name (Similar, brief #17)", () => {
        const comic = parseComickComic({
            comic: {
                recommendations: [
                    { total: 5, relates: { title: 'I am the only the one who levels up', slug: '00-solo-leveling' } },
                    { total: 3, relates: { title: 'Item-ppal', slug: 'item-ppal' } },
                ],
            },
        });
        expect(comic.recommendations.map(({ media }) => media.title?.english)).toEqual(['Solo Leveling', 'Item-ppal']);
    });

    it('a comic page: its AniList id, and its recommendations by votes', () => {
        const comic = parseComickComic({
            comic: {
                hid: 'abc',
                links: { al: '119257' },
                recommendations: [
                    { up: 3, down: 0, total: 3, relates: hit(1) },
                    { up: 9, down: 1, total: 8, relates: hit(2) },
                    { up: 2, down: 0, relates: hit(3) },
                ],
            },
        });
        expect(comic.anilistId).toBe(119_257);
        expect(comic.recommendations.map(({ media, votes }) => [media.id, votes])).toEqual([
            [-1_000_000_002, 8],
            [-1_000_000_001, 3],
            [-1_000_000_003, 2],
        ]);
    });
});

const listResponse = {
    MediaListCollection: {
        lists: [
            {
                isCustomList: false,
                entries: [
                    {
                        mediaId: 500,
                        status: 'COMPLETED',
                        progress: 100,
                        media: {
                            title: { english: 'Comick 1', romaji: 'Komikku Ichi', userPreferred: 'Komikku Ichi' },
                        },
                    },
                ],
            },
        ],
    },
};

describe('Comick cards on the list', () => {
    it('take the AniList id of the list title they match, by any of its titles', () => {
        const index = parseListTitleIndex(listResponse);
        const [matched, other, aniList] = adoptListIds(
            [toComickMedia(hit(1))!, toComickMedia(hit(2))!, toComickMedia(hit(3, { links: { al: 77 } }))!],
            index,
        );
        expect([matched.id, other.id, aniList.id]).toEqual([500, -1_000_000_002, 77]);
        expect(adoptListIds([toComickMedia(hit(1, { title: 'KOMIKKU  ichi!' }))!], index)[0].id).toBe(500);
    });
});

describe('Similar extras from Comick', () => {
    it('by votes, without what AniList already shows (by id, then title) and without the series itself', () => {
        const recommendations = [
            { media: toComickMedia(hit(1))!, votes: 2 },
            { media: toComickMedia(hit(2, { title: 'Already Shown' }))!, votes: 9 },
            { media: toComickMedia(hit(3, { links: { al: 42 } }))!, votes: 5 },
            { media: toComickMedia(hit(4, { links: { al: 900 } }))!, votes: 7 },
            { media: toComickMedia(hit(5))!, votes: 4 },
        ];
        const extras = getComickExtras(recommendations, {
            shown: [
                { id: 42, title: { english: null, romaji: null, userPreferred: 'x' } },
                { id: 43, title: { english: 'Already Shown', romaji: null, userPreferred: null } },
            ],
            seedId: 900,
            index: null,
        });
        expect(extras.map(({ id }) => id)).toEqual([-1_000_000_005, -1_000_000_001]);
    });

    it('the same series twice on Comick: the AniList-linked entry wins, at the better-voted place', () => {
        const pets = 'Starting As The God Of Wealth, Taming Billions Of Divine Pets!';
        const extras = getComickExtras(
            [
                { media: toComickMedia(hit(10, { title: `${pets}404`, md_titles: [] }))!, votes: 9 },
                { media: toComickMedia(hit(11))!, votes: 6 },
                { media: toComickMedia(hit(12, { title: pets, links: { al: 202246 } }))!, votes: 3 },
            ],
            { shown: [], seedId: 900, index: null },
        );
        expect(extras.map(({ id }) => id)).toEqual([202_246, -1_000_000_011]);
    });

    it('twins by a shared non-Latin title; a sequel number ("Title 2") is not a twin', () => {
        const extras = getComickExtras(
            [
                {
                    media: toComickMedia(
                        hit(20, {
                            slug: 'pinyin-name',
                            title: 'Pinyin Name',
                            md_titles: [{ title: '开局神豪驯养亿万神宠' }],
                        }),
                    )!,
                    votes: 5,
                },
                {
                    media: toComickMedia(
                        hit(21, {
                            slug: 'english-name',
                            title: 'English Name',
                            md_titles: [{ title: '开局神豪驯养亿万神宠' }],
                            links: { al: 7 },
                        }),
                    )!,
                    votes: 2,
                },
                { media: toComickMedia(hit(22, { title: 'Solo Leveling', md_titles: [] }))!, votes: 4 },
                { media: toComickMedia(hit(23, { title: 'Solo Leveling 2', md_titles: [] }))!, votes: 1 },
            ],
            { shown: [], seedId: 900, index: null },
        );
        expect(extras.map(({ id }) => id)).toEqual([7, -1_000_000_022, -1_000_000_023]);
    });
});

describe('For You from Comick', () => {
    it('votes x how much the seed was liked; list titles (matched by title) and the seeds left out', () => {
        const seeds = [
            { mediaId: 1000, title: 'Liked A', weight: 2 },
            { mediaId: 1001, title: 'Liked B', weight: 1 },
        ];
        const matches = mergeComickBestMatches({
            seeds,
            recommendations: [
                [
                    { media: toComickMedia(hit(1))!, votes: 5 },
                    { media: toComickMedia(hit(2))!, votes: 4 },
                ],
                [
                    { media: toComickMedia(hit(2))!, votes: 10 },
                    { media: toComickMedia(hit(9, { links: { al: 1000 } }))!, votes: 50 },
                ],
            ],
            listedIds: [500],
            index: parseListTitleIndex(listResponse),
        });
        // Comick 1 is "Comick 1" on the list (id 500); Comick 9 is seed 1000 itself.
        expect(matches.map(({ id, bestScore, sources }) => [id, bestScore, sources])).toEqual([
            [-1_000_000_002, 18, ['comick']],
        ]);
        expect(matches[0].seedRatings).toEqual({ 1000: 4, 1001: 10 });
    });
});
