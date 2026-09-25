/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ComicType, RecMedia, RecTag } from '@/features/tsuji/recs/Recs.types.ts';

export const isSpoilerTag = (tag: RecTag): boolean => !!tag.isMediaSpoiler || !!tag.isGeneralSpoiler;

/** AniList "Technical" tags (Long Strip, Full Color, 4-koma...) describe format, not content. */
export const isTechnicalTag = (tag: RecTag): boolean => tag.category === 'Technical';

/** Non-spoiler tags, highest rank first. */
export const getVisibleTags = (media: Pick<RecMedia, 'tags'>): RecTag[] =>
    (media.tags ?? []).filter((tag) => !isSpoilerTag(tag)).sort((a, b) => (b.rank ?? 0) - (a.rank ?? 0));

/** Non-spoiler, non-technical tags, highest rank first: for tag recall and card chips. */
export const getContentTags = (media: Pick<RecMedia, 'tags'>): RecTag[] =>
    getVisibleTags(media).filter((tag) => !isTechnicalTag(tag));

export const getDisplayTitle = (media: Pick<RecMedia, 'title'>): string =>
    media.title?.english ?? media.title?.userPreferred ?? media.title?.romaji ?? '';

export const getAllTitles = (media: Pick<RecMedia, 'title'>): (string | null)[] => [
    media.title?.english ?? null,
    media.title?.romaji ?? null,
    media.title?.userPreferred ?? null,
];

export const getComicType = (countryOfOrigin: string | null | undefined): ComicType | null => {
    switch (countryOfOrigin) {
        case 'KR':
            return 'MANHWA';
        case 'JP':
            return 'MANGA';
        case 'CN':
        case 'TW':
            return 'MANHUA';
        default:
            return null;
    }
};

const truncateToOneDecimal = (value: number): string => String(Math.floor(value * 10) / 10);

/** 999 -> "999", 1450 -> "1.4k", 2000 -> "2k", 2_300_000 -> "2.3M". */
export const abbreviateCount = (value: number): string => {
    if (value < 1000) {
        return String(value);
    }

    if (value < 1_000_000) {
        return `${truncateToOneDecimal(value / 1000)}k`;
    }

    return `${truncateToOneDecimal(value / 1_000_000)}M`;
};

/** AniList's description (asHtml: false) still carries <br> and <i>; parse to plain text, never render as HTML. */
export const htmlToPlainText = (html: string | null | undefined): string => {
    if (!html) {
        return '';
    }

    const withBreaks = html.replaceAll(/<br\s*\/?>/gi, '\n');
    const text = new DOMParser().parseFromString(withBreaks, 'text/html').body.textContent ?? '';

    return text.replaceAll(/\n{3,}/g, '\n\n').trim();
};

export const isAniListUrl = (url: string | null | undefined): url is string =>
    !!url && url.startsWith('https://anilist.co/');
