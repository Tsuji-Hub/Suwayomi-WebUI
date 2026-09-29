/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Duplicate chapters: a source can list one entry per scanlator for the same chapter. Copies are chapters of the
 * same manga with the same chapterNumber >= 0. A negative number (-1: the source couldn't parse one) never makes
 * copies: those chapters are all different (extras, specials, oddly named chapters).
 */

export type CopyInfo = {
    id: number;
    chapterNumber: number;
    scanlator?: string | null;
    sourceOrder: number;
};

type ReadCopyInfo = CopyInfo & { isRead: boolean; lastReadAt?: string | number | null };

export const hasCopies = (chapterNumber: number): boolean => chapterNumber >= 0;

const bySourceOrder = (a: CopyInfo, b: CopyInfo) => a.sourceOrder - b.sourceOrder;

/**
 * The copy to use from `group` (copies of one number): the reference chapter itself, else the reference's
 * scanlator, else the first by source order.
 */
export const pickCopy = <T extends CopyInfo>(
    group: T[],
    reference: Pick<CopyInfo, 'id' | 'scanlator'> | null | undefined,
): T => {
    const sorted = [...group].sort(bySourceOrder);
    return (
        sorted.find(({ id }) => id === reference?.id) ??
        (reference ? sorted.find(({ scanlator }) => scanlator === reference.scanlator) : undefined) ??
        sorted[0]
    );
};

/** Upstream `Chapters.addDuplicates`, without grouping negative numbers: each chapter plus its copies, deduped. */
export const tsujiAddDuplicates = <T extends Pick<CopyInfo, 'id' | 'chapterNumber'>>(
    uniqueChapters: T[],
    allChapters: T[],
): T[] => {
    const result = new Map<number, T>();
    uniqueChapters.forEach((chapter) => {
        const copies = hasCopies(chapter.chapterNumber)
            ? allChapters.filter(({ chapterNumber }) => chapterNumber === chapter.chapterNumber)
            : [];
        [chapter, ...copies].forEach((copy) => result.set(copy.id, copy));
    });
    return [...result.values()];
};

/**
 * Upstream `Chapters.removeDuplicates` (the reader's chapter list with "Skip duplicate chapters"): one copy per
 * number, picked by `pickCopy` with the reader's reference chapter; negative numbers are all kept. Order of
 * `chapters` is kept.
 */
export const tsujiRemoveDuplicates = <T extends CopyInfo>(
    reference: Pick<CopyInfo, 'id' | 'scanlator'>,
    chapters: T[],
): T[] => {
    const groups = new Map<number, T[]>();
    chapters.forEach((chapter) => {
        if (hasCopies(chapter.chapterNumber)) {
            groups.set(chapter.chapterNumber, [...(groups.get(chapter.chapterNumber) ?? []), chapter]);
        }
    });
    const kept = new Set([...groups.values()].map((group) => pickCopy(group, reference).id));

    return chapters.filter((chapter) => !hasCopies(chapter.chapterNumber) || kept.has(chapter.id));
};

/**
 * Ids to mark read when `idsToMarkRead` are marked read: those plus every unread copy of the same numbers (>= 0).
 * Never another number, never unread.
 */
export const getIdsWithReadCopies = (
    idsToMarkRead: number[],
    mangaChapters: Pick<ReadCopyInfo, 'id' | 'chapterNumber' | 'isRead'>[],
): number[] => {
    const marked = new Set(idsToMarkRead);
    const numbers = new Set(
        mangaChapters
            .filter(({ id, chapterNumber }) => marked.has(id) && hasCopies(chapterNumber))
            .map(({ chapterNumber }) => chapterNumber),
    );
    const copies = mangaChapters
        .filter(({ id, chapterNumber, isRead }) => !marked.has(id) && !isRead && numbers.has(chapterNumber))
        .map(({ id }) => id);

    return [...idsToMarkRead, ...copies];
};

const readTime = (value: string | number | null | undefined) => Number(value ?? 0) || 0;

/**
 * Continue / Resume: the first chapter (by source order) whose number has no read copy; negative numbers count
 * alone. Among a number's copies: the scanlator last finished in the reader (`preferredScanlator`, undefined when
 * unknown), else the scanlator of the furthest read chapter (ties: the most recent read, then source order), else
 * the first by source order. Copies of excluded scanlators are never picked. Null when everything is read.
 */
export const getResumeChapter = <T extends ReadCopyInfo>(
    chapters: T[],
    preferredScanlator?: string | null,
    excludedScanlators: (string | null | undefined)[] = [],
): T | null => {
    const sorted = [...chapters].sort(bySourceOrder);
    // Excluded scanlators (chapter list filter) still count as read, but Resume never opens one of their copies.
    const isAllowed = ({ scanlator }: T) => !excludedScanlators.includes(scanlator);
    const readCopies = sorted.filter(({ isRead, chapterNumber }) => isRead && hasCopies(chapterNumber));
    const readNumbers = new Set(readCopies.map(({ chapterNumber }) => chapterNumber));
    const [furthestRead] = [...readCopies].sort(
        (a, b) =>
            b.chapterNumber - a.chapterNumber ||
            readTime(b.lastReadAt) - readTime(a.lastReadAt) ||
            b.sourceOrder - a.sourceOrder,
    );

    const next = sorted.find(
        (chapter) =>
            isAllowed(chapter) &&
            (hasCopies(chapter.chapterNumber) ? !readNumbers.has(chapter.chapterNumber) : !chapter.isRead),
    );
    if (!next) {
        return null;
    }
    if (!hasCopies(next.chapterNumber)) {
        return next;
    }

    const group = sorted.filter((copy) => copy.chapterNumber === next.chapterNumber && isAllowed(copy));
    const scanlator =
        preferredScanlator !== undefined && group.some((copy) => copy.scanlator === preferredScanlator)
            ? preferredScanlator
            : furthestRead?.scanlator;

    return pickCopy(group, scanlator !== undefined ? { id: -1, scanlator } : null);
};

/**
 * Hook for upstream's chapter list Resume button: the first chapter number with no read copy, from the loaded
 * list. Falls back to the server's `firstUnreadChapter` while the list isn't loaded.
 */
export const getTsujiResumeChapter = <T extends ReadCopyInfo, F>(
    chapters: T[],
    serverFirstUnread: F,
    preferredScanlator?: string | null,
    excludedScanlators?: (string | null | undefined)[],
): T | F | null =>
    chapters.length ? getResumeChapter(chapters, preferredScanlator, excludedScanlators) : serverFirstUnread;

/** `tsuji_readScanlator` value: JSON of the scanlator (null kept apart from unknown). */
export const parseReadScanlator = (raw: string | undefined): string | null | undefined => {
    if (raw === undefined) {
        return undefined;
    }
    try {
        const value: unknown = JSON.parse(raw);
        return typeof value === 'string' || value === null ? value : undefined;
    } catch {
        return undefined;
    }
};
