/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getContentTags } from '@/features/tsuji/recs/media.ts';
import type { BestMatch, ForYouCandidate } from '@/features/tsuji/forYou/forYouCandidates.ts';
import type { ForYouData } from '@/features/tsuji/forYou/ForYouService.ts';

/*
 * The week as stored (brief #13): TsujiCache refuses entries over 300,000 characters, and a week with Best matches
 * as full media (~270 titles, ~2 KB each) was never written, so every page load asked AniList again. Stored: each
 * title once (Top picks and Best matches share it), only what the cards, the ranking and the preview read, and the
 * lists as ids with their scores. A guard drops the weakest entries if it still wouldn't fit.
 */

export const MAX_STORED_DESCRIPTION = 160;
export const MAX_STORED_TAGS = 8;
/** Room under TsujiCache's 300,000-character entry limit. */
export const MAX_WEEK_CHARS = 250_000;

type CandidateRef = Pick<ForYouCandidate, 'id' | 'edgeRating' | 'sources' | 'seedRatings'>;
type BestRef = CandidateRef & Pick<BestMatch, 'bestScore'>;

export type StoredWeek = Omit<ForYouData, 'candidates' | 'bestMatches'> & {
    media: RecMedia[];
    candidates: CandidateRef[];
    bestMatches: BestRef[];
};

/** What the cards, the ranking and the preview need from a title (content tags as name + rank only). */
export const compactMedia = (media: RecMedia): RecMedia => ({
    id: media.id,
    idMal: media.idMal,
    siteUrl: media.siteUrl,
    title: media.title,
    coverImage: media.coverImage?.large ? { large: media.coverImage.large } : null,
    description: media.description?.slice(0, MAX_STORED_DESCRIPTION) ?? null,
    averageScore: media.averageScore,
    meanScore: media.meanScore,
    popularity: media.popularity,
    favourites: media.favourites,
    countryOfOrigin: media.countryOfOrigin,
    format: media.format,
    status: media.status,
    chapters: media.chapters,
    isAdult: media.isAdult,
    startDate: media.startDate,
    tags: getContentTags(media)
        .slice(0, MAX_STORED_TAGS)
        .map(({ name, rank }) => ({ name, rank })),
    ...(media.via ? { via: media.via } : {}),
});

const toRef = ({ id, edgeRating, sources, seedRatings }: ForYouCandidate): CandidateRef => ({
    id,
    edgeRating: Math.round(edgeRating * 100) / 100,
    sources,
    seedRatings,
});

const pack = (data: ForYouData, candidates: ForYouCandidate[], bestMatches: BestMatch[]): StoredWeek => {
    const media = new Map<number, RecMedia>();
    [...bestMatches, ...candidates].forEach((item) => {
        if (!media.has(item.id)) {
            media.set(item.id, compactMedia(item));
        }
    });
    const { candidates: _candidates, bestMatches: _best, ...rest } = data;
    return {
        ...rest,
        media: [...media.values()],
        candidates: candidates.map(toRef),
        bestMatches: bestMatches.map((match) => ({
            ...toRef(match),
            bestScore: Math.round(match.bestScore * 100) / 100,
        })),
    };
};

/** The week to store: compact, and cut down (weakest first, both lists) until it fits the cache. */
export const toStoredWeek = (data: ForYouData): StoredWeek => {
    let { candidates, bestMatches } = data;
    let stored = pack(data, candidates, bestMatches);
    while (JSON.stringify(stored).length > MAX_WEEK_CHARS && (candidates.length || bestMatches.length)) {
        candidates = candidates.slice(0, Math.floor(candidates.length * 0.8));
        bestMatches = bestMatches.slice(0, Math.floor(bestMatches.length * 0.8));
        stored = pack(data, candidates, bestMatches);
    }
    return stored;
};

/** The stored week back as For You reads it (entries whose title is missing are dropped). */
export const fromStoredWeek = (stored: StoredWeek): ForYouData => {
    const media = new Map(stored.media.map((item) => [item.id, item]));
    const { media: _media, candidates, bestMatches, ...rest } = stored;
    return {
        ...rest,
        candidates: candidates.flatMap((ref) => {
            const item = media.get(ref.id);
            return item ? [{ ...item, ...ref }] : [];
        }),
        bestMatches: bestMatches.flatMap((ref) => {
            const item = media.get(ref.id);
            return item ? [{ ...item, ...ref }] : [];
        }),
    };
};
