/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

export type RecTag = {
    name: string;
    rank: number | null;
    category?: string | null;
    isMediaSpoiler?: boolean | null;
    isGeneralSpoiler?: boolean | null;
    isAdult?: boolean | null;
};

export type RecMediaStatus = 'FINISHED' | 'RELEASING' | 'NOT_YET_RELEASED' | 'CANCELLED' | 'HIATUS';

export type ComicType = 'MANHWA' | 'MANGA' | 'MANHUA';

/** AniList Media, as selected by MEDIA_FIELDS (aniListQueries.ts). */
export type RecMedia = {
    id: number;
    idMal: number | null;
    siteUrl: string | null;
    title: { userPreferred: string | null; english: string | null; romaji: string | null } | null;
    coverImage: { large: string | null } | null;
    description: string | null;
    averageScore: number | null;
    meanScore: number | null;
    popularity: number | null;
    favourites: number | null;
    countryOfOrigin: string | null;
    format: string | null;
    status: string | null;
    chapters: number | null;
    isAdult: boolean | null;
    startDate: { year: number | null; month: number | null; day: number | null } | null;
    tags: RecTag[] | null;
};

/** "anilist" = AniList recommendation edge, "mal" = Jikan (MAL) recommendation, "tags" = tag recall. */
export type RecSourceId = 'anilist' | 'mal' | 'tags';

export type RecCandidate = RecMedia & { edgeRating: number; sources: RecSourceId[] };

/** A recommendation reference from an external source; hydrated to AniList media by id. */
export type RecRef = {
    source: RecSourceId;
    malId?: number;
    anilistId?: number;
    title?: string;
    votes?: number;
};

export type RecSourceContext = { anilistId: number; idMal: number | null; signal: AbortSignal };

/**
 * Pluggable recommendation source. v1 ships Jikan; MangaUpdates / MangaDex-Similar / Comick need a server-side
 * proxy (no browser CORS) and plug in here later, returning title or id refs.
 */
export type RecSource = {
    id: RecSourceId;
    fetchRefs: (context: RecSourceContext) => Promise<RecRef[]>;
};
