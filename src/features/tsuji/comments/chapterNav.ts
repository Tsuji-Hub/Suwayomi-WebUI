/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * The Comments panel's chapter selector (Makimono's CommentsScreen header): it steps through chapter numbers, not
 * Suwayomi chapter ids, so scanlator copies of one number are a single entry. Chapters without a number (-1) have
 * no thread to look up and are left out.
 */

export type CommentChapter = { number: number; label: string };

export type NavChapterInfo = {
    chapterNumber: number;
    name: string;
    scanlator?: string | null;
    sourceOrder: number;
};

const formatNumber = (value: number) => String(Math.round(value * 1000) / 1000);

const escapeRegExp = (value: string) => value.replaceAll(/[.*+?^${}()|[\]\\]/g, String.raw`\$&`);

/**
 * "Ch. 75 - The Devil Seeker (2)": the number, then the chapter name without a leading "Chapter 75" / "Ch. 75"
 * (most sources repeat the number in the name). Just "Ch. 75" when nothing else is left.
 */
export const formatChapterLabel = (chapterNumber: number, name: string): string => {
    const number = formatNumber(chapterNumber);
    const prefix = new RegExp(
        String.raw`^\s*(?:chapter|chap\.?|ch\.?|episode|ep\.?)?\s*0*${escapeRegExp(number)}(?![\d.])\s*[-:.,]?\s*`,
        'i',
    );
    const rest = name.replace(prefix, '').trim();
    return rest ? `Ch. ${number} - ${rest}` : `Ch. ${number}`;
};

/**
 * One entry per chapter number >= 0, ascending. Among copies of a number the label comes from the reference
 * scanlator's copy (the one being read, or the last read), else the first by source order.
 */
export const buildCommentChapters = (
    chapters: NavChapterInfo[],
    referenceScanlator?: string | null,
): CommentChapter[] => {
    const picked = new Map<number, NavChapterInfo>();
    [...chapters]
        .filter(({ chapterNumber }) => Number.isFinite(chapterNumber) && chapterNumber >= 0)
        .sort((a, b) => a.sourceOrder - b.sourceOrder)
        .forEach((chapter) => {
            const current = picked.get(chapter.chapterNumber);
            const isReference = referenceScanlator !== undefined && chapter.scanlator === referenceScanlator;
            const isCurrentReference = referenceScanlator !== undefined && current?.scanlator === referenceScanlator;
            if (!current || (isReference && !isCurrentReference)) {
                picked.set(chapter.chapterNumber, chapter);
            }
        });

    return [...picked.values()]
        .sort((a, b) => a.chapterNumber - b.chapterNumber)
        .map(({ chapterNumber, name }) => ({ number: chapterNumber, label: formatChapterLabel(chapterNumber, name) }));
};

/** The number one step away from `current` (it need not be in the list itself), or null at that end. */
export const getChapterStep = (chapters: CommentChapter[], current: number, direction: -1 | 1): number | null => {
    if (direction === 1) {
        return chapters.find(({ number }) => number > current)?.number ?? null;
    }
    return chapters.findLast(({ number }) => number < current)?.number ?? null;
};

/**
 * Where the picker opens: the entry of `current`, else the last entry below it (a number missing from the list,
 * e.g. the reader on a chapter the list doesn't have), else 0.
 */
export const getPickerIndex = (chapters: CommentChapter[], current: number): number => {
    const exact = chapters.findIndex(({ number }) => number === current);
    if (exact !== -1) {
        return exact;
    }
    return Math.max(
        0,
        chapters.findLastIndex(({ number }) => number < current),
    );
};

/** The selector's label for `current`: the list entry's label, else just the number. */
export const getChapterLabel = (chapters: CommentChapter[], current: number): string =>
    chapters.find(({ number }) => number === current)?.label ?? `Ch. ${formatNumber(current)}`;

/**
 * Reference scanlator on the series page: the scanlator of the most recently read chapter (by lastReadAt), or
 * undefined when nothing was read.
 */
export const getLastReadScanlator = (
    chapters: { scanlator?: string | null; lastReadAt?: string | number | null }[],
): string | null | undefined => {
    const [latest] = chapters
        .map(({ scanlator, lastReadAt }) => ({ scanlator: scanlator ?? null, time: Number(lastReadAt ?? 0) || 0 }))
        .filter(({ time }) => time > 0)
        .sort((a, b) => b.time - a.time);
    return latest ? latest.scanlator : undefined;
};
