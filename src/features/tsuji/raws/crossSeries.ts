/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { parseRawLinks } from '@/features/tsuji/raws/rawLinks.ts';

/** Reading across the English and the MTL series (brief #19), pure part: see mtlSequence.ts. */

export type ForeignChapter = { number: number; path: string };

export type CutChapter = { id: number; chapterNumber: number };

const isBefore = (foreign: number, own: CutChapter | undefined, preferForeign: boolean) =>
    !own ||
    (own.chapterNumber >= 0 && (foreign < own.chapterNumber || (preferForeign && foreign === own.chapterNumber)));

/**
 * The reader's chapters (newest first) cut where a foreign chapter comes next or before, and those foreign chapters.
 * Nothing changes without a current chapter with a number.
 */
export const cutAtForeign = <T extends CutChapter>(
    current: CutChapter | null | undefined,
    chapters: T[],
    foreign: ForeignChapter[],
    preferForeign: boolean,
): { chapters: T[]; next: ForeignChapter | null; previous: ForeignChapter | null } => {
    const index = current ? chapters.findIndex(({ id }) => id === current.id) : -1;
    if (!current || index === -1 || current.chapterNumber < 0 || !foreign.length) {
        return { chapters, next: null, previous: null };
    }
    const number = current.chapterNumber;
    const nextForeign = foreign.find((chapter) => chapter.number > number) ?? null;
    const previousForeign = foreign.findLast((chapter) => chapter.number < number) ?? null;
    const next = nextForeign && isBefore(nextForeign.number, chapters[index - 1], preferForeign) ? nextForeign : null;
    const previousOwn = chapters[index + 1];
    const previous =
        previousForeign &&
        (!previousOwn ||
            (previousOwn.chapterNumber >= 0 &&
                (previousForeign.number > previousOwn.chapterNumber ||
                    (preferForeign && previousForeign.number === previousOwn.chapterNumber))))
            ? previousForeign
            : null;

    return {
        chapters: chapters.slice(next ? index : 0, previous ? index + 1 : undefined),
        next,
        previous,
    };
};

/**
 * The English chapter list with MTL chapters where English has no chapter of that number (in the filter), each placed
 * by number in the list's order (newest first or oldest first, read from the list itself; `isDesc` when it can't
 * tell). An MTL chapter of a number English has is left out.
 */
export const mergeInlineMtl = <T extends { chapterNumber: number }>(
    list: T[],
    mtl: T[],
    englishNumbers: Set<number>,
    isDesc: boolean,
): T[] => {
    const extra = mtl
        .filter(({ chapterNumber }) => chapterNumber >= 0 && !englishNumbers.has(chapterNumber))
        .sort((a, b) => a.chapterNumber - b.chapterNumber);
    if (!extra.length) {
        return list;
    }
    const numbered = list.filter(({ chapterNumber }) => chapterNumber >= 0);
    const desc = numbered.length > 1 ? numbered[0].chapterNumber > numbered[numbered.length - 1].chapterNumber : isDesc;
    const result = [...list];
    (desc ? [...extra].reverse() : extra).forEach((chapter) => {
        const index = result.findIndex(
            ({ chapterNumber }) =>
                chapterNumber >= 0 &&
                (desc ? chapterNumber < chapter.chapterNumber : chapterNumber > chapter.chapterNumber),
        );
        result.splice(index === -1 ? result.length : index, 0, chapter);
    });
    return result;
};

/** The English title an MTL series ("<title> [MTL]") translates, or null. */
export const getMtlBaseTitle = (title: string | null | undefined): string | null => {
    const match = /^(.*\S)\s*\[MTL\]\s*$/i.exec(title ?? '');
    return match ? match[1] : null;
};

/**
 * The English series of an MTL series among library series (`tsuji_raw_links` naming it as their MTL): the one read
 * last when several copies link it (Asura and MangaFire both translate to one MTL series).
 */
export const pickMtlParent = (
    mtlId: number,
    candidates: { id: number; meta: { key: string; value: string }[]; lastReadAt: number }[],
): number | null =>
    candidates
        .filter(({ meta }) =>
            meta.some(
                ({ key, value }) => key === TSUJI_META_KEYS.rawLinks && parseRawLinks(value).mtl?.mangaId === mtlId,
            ),
        )
        .sort((a, b) => b.lastReadAt - a.lastReadAt || a.id - b.id)[0]?.id ?? null;
