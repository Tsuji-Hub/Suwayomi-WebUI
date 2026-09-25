/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';

/*
 * AniList GraphQL documents (plain strings: external API, sent with fetch, not Apollo).
 * Every media list selects MEDIA_FIELDS so Similar and Discover share one card shape (RecMedia).
 */

const MEDIA_FIELDS = `
    fragment TsujiMedia on Media {
        id
        idMal
        siteUrl
        title { userPreferred english romaji }
        coverImage { large }
        description(asHtml: false)
        averageScore
        meanScore
        popularity
        favourites
        countryOfOrigin
        format
        status
        chapters
        isAdult
        startDate { year month day }
        tags { name rank category isMediaSpoiler isGeneralSpoiler isAdult }
    }
`;

export const SEED_QUERY = `
    ${MEDIA_FIELDS}
    query TsujiSimilarSeed($id: Int) {
        Media(id: $id, type: MANGA) {
            id
            idMal
            tags { name rank category isMediaSpoiler isGeneralSpoiler isAdult }
            recommendations(sort: RATING_DESC, perPage: 25) {
                nodes { rating mediaRecommendation { ...TsujiMedia } }
            }
        }
    }
`;

export type SeedResponse = {
    Media: {
        id: number;
        idMal: number | null;
        tags: RecTag[] | null;
        recommendations: { nodes: { rating: number | null; mediaRecommendation: RecMedia | null }[] } | null;
    } | null;
};

/** Tag recall and MAL-id mapping share one request to save the rate budget. */
export const HYDRATE_QUERY = `
    ${MEDIA_FIELDS}
    query TsujiSimilarHydrate($tags: [String], $withTags: Boolean!, $malIds: [Int], $withMal: Boolean!) {
        recall: Page(perPage: 25) @include(if: $withTags) {
            media(tag_in: $tags, type: MANGA, sort: [POPULARITY_DESC], minimumTagRank: 60) { ...TsujiMedia }
        }
        mal: Page(perPage: 25) @include(if: $withMal) {
            media(idMal_in: $malIds, type: MANGA) { ...TsujiMedia }
        }
    }
`;

export type HydrateResponse = {
    recall?: { media: RecMedia[] | null } | null;
    mal?: { media: RecMedia[] | null } | null;
};

export const BY_MAL_QUERY = `
    query TsujiByMal($idMal: Int) {
        Media(idMal: $idMal, type: MANGA) { id }
    }
`;

export type ByMalResponse = { Media: { id: number } | null };

export const SEARCH_QUERY = `
    query TsujiSearch($search: String) {
        Page(perPage: 10) {
            media(search: $search, type: MANGA) {
                id
                title { romaji english native userPreferred }
                synonyms
            }
        }
    }
`;

export type SearchResponse = {
    Page: {
        media:
            | {
                  id: number;
                  title: {
                      romaji: string | null;
                      english: string | null;
                      native: string | null;
                      userPreferred: string | null;
                  } | null;
                  synonyms: (string | null)[] | null;
              }[]
            | null;
    } | null;
};

export const TAG_CATALOG_QUERY = `
    query TsujiTagCatalog {
        MediaTagCollection { name description category isAdult }
        GenreCollection
    }
`;

export type CatalogTag = { name: string; description: string | null; category: string | null; isAdult: boolean | null };

export type TagCatalogResponse = { MediaTagCollection: CatalogTag[] | null; GenreCollection: string[] | null };

const DISCOVER_FILTER_VARIABLES = `
    $genreIn: [String], $genreNotIn: [String], $tagIn: [String], $tagNotIn: [String],
    $formatNotIn: [MediaFormat], $statusIn: [MediaStatus], $country: CountryCode, $minScore: Int, $isAdult: Boolean
`;

const DISCOVER_FILTER_ARGUMENTS = `
    type: MANGA, genre_in: $genreIn, genre_not_in: $genreNotIn, tag_in: $tagIn, tag_not_in: $tagNotIn,
    minimumTagRank: 18, format_not_in: $formatNotIn, status_in: $statusIn, countryOfOrigin: $country,
    averageScore_greater: $minScore, isAdult: $isAdult
`;

export const DISCOVER_PAGE_QUERY = `
    ${MEDIA_FIELDS}
    query TsujiDiscoverPage($page: Int, $perPage: Int, $sort: [MediaSort], ${DISCOVER_FILTER_VARIABLES}) {
        Page(page: $page, perPage: $perPage) {
            pageInfo { hasNextPage }
            media(sort: $sort, ${DISCOVER_FILTER_ARGUMENTS}) { ...TsujiMedia }
        }
    }
`;

export type DiscoverPageResponse = {
    Page: { pageInfo: { hasNextPage: boolean | null } | null; media: RecMedia[] | null } | null;
};
