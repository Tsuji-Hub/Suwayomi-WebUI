/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { create } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { AppRoutes } from '@/base/AppRoute.constants.ts';
import { ReactRouter } from '@/lib/react-router/ReactRouter.ts';
import { getReaderChaptersStore } from '@/features/reader/stores/ReaderStore.ts';
import { getReaderOpenChapterResumeMode } from '@/features/reader/Reader.utils.ts';
import { READER_DEFAULT_CHAPTERS_STATE } from '@/features/reader/stores/ReaderChaptersStore.ts';
import type { ReaderResumeMode } from '@/features/reader/Reader.types.ts';
import type { CutChapter, ForeignChapter } from '@/features/tsuji/raws/crossSeries.ts';
import { cutAtForeign } from '@/features/tsuji/raws/crossSeries.ts';

export type { ForeignChapter } from '@/features/tsuji/raws/crossSeries.ts';

/*
 * Reading across the English and the MTL series (brief #19): 224 -> MTL 225 -> 226. The reader only knows one
 * series' chapters, so the other series' chapters ("foreign") that belong in between are kept here: in the English
 * reader the MTL chapters whose number English lacks in the scanlator filter (a tie is an English copy outside the
 * filter: the MTL chapter wins), in the MTL reader the English chapters in the filter (English wins a tie). Where a
 * foreign chapter comes next, the reader's own list is cut there (infinite scroll stops, the end card shows) and
 * Next / Previous open the foreign chapter instead.
 */

type ForeignState = {
    /** The reader manga these are for. */
    mangaId: number | null;
    /** Sorted by number. */
    chapters: ForeignChapter[];
    /** On a tie with the reader's own next chapter: the foreign one (MTL reader: English first). */
    preferForeign: boolean;
    /** Targets of the current chapter (set when the reader's list is cut). */
    currentId: number | null;
    next: ForeignChapter | null;
    previous: ForeignChapter | null;
};

const EMPTY: ForeignState = {
    mangaId: null,
    chapters: [],
    preferForeign: false,
    currentId: null,
    next: null,
    previous: null,
};

const useForeignStore = create<ForeignState>(() => EMPTY);

/**
 * Opens a chapter of another series (English <-> MTL, the raw). The reader stays mounted across series and keeps the
 * previous series' chapters in its state (it never changes series itself): those are dropped first, so the new
 * series' list and chapter are read fresh.
 */
export const openSeriesChapter = (
    path: string,
    { replace = false, resumeMode }: { replace?: boolean; resumeMode?: ReaderResumeMode } = {},
) => {
    const targetMangaId = Number(/^\/manga\/(\d+)\//.exec(path)?.[1]);
    const { currentChapter, setReaderStateChapters } = getReaderChaptersStore();
    if (currentChapter && currentChapter.mangaId !== targetMangaId) {
        setReaderStateChapters((state) => ({ ...state, ...READER_DEFAULT_CHAPTERS_STATE.chapters }));
    }
    ReactRouter.navigate(path, { replace, state: AppRoutes.reader.state({ resumeMode, updateInitialChapter: true }) });
};

/** The reader layer's foreign chapters for the reader manga (cleared on leave). */
export const setForeignChapters = (mangaId: number | null, chapters: ForeignChapter[], preferForeign: boolean) => {
    const sorted = [...chapters].sort((a, b) => a.number - b.number);
    const state = useForeignStore.getState();
    const isSame =
        state.mangaId === mangaId &&
        state.preferForeign === preferForeign &&
        state.chapters.length === sorted.length &&
        state.chapters.every(
            (chapter, index) => chapter.path === sorted[index].path && chapter.number === sorted[index].number,
        );
    if (!isSame) {
        useForeignStore.setState({ mangaId, chapters: sorted, preferForeign });
    }
};

export const clearForeignChapters = () => useForeignStore.setState(EMPTY, true);

/** For the reader's chapter list effect (a change re-runs it). */
export const useTsujiForeignChapters = () =>
    useForeignStore(useShallow(({ mangaId, chapters, preferForeign }) => ({ mangaId, chapters, preferForeign })));

/**
 * Upstream hook (useReaderSetChaptersState): the reader's visible chapters, cut where a foreign chapter comes next;
 * remembers the current chapter's foreign Next / Previous.
 */
export const tsujiCutAtForeign = <T extends CutChapter>(
    current: CutChapter | null | undefined,
    chapters: T[],
    foreign: Pick<ForeignState, 'mangaId' | 'chapters' | 'preferForeign'>,
    mangaId: number | null | undefined,
): T[] => {
    if (!foreign.mangaId || foreign.mangaId !== mangaId) {
        if (useForeignStore.getState().currentId !== null) {
            useForeignStore.setState({ currentId: null, next: null, previous: null });
        }
        return chapters;
    }
    const cut = cutAtForeign(current, chapters, foreign.chapters, foreign.preferForeign);
    useForeignStore.setState({ currentId: current?.id ?? null, next: cut.next, previous: cut.previous });
    return cut.chapters;
};

/** Next / Previous buttons: a foreign chapter counts as one. */
export const useTsujiForeignTargets = () =>
    useForeignStore(useShallow(({ next, previous }) => ({ hasNext: !!next, hasPrevious: !!previous })));

/**
 * Upstream hook (ReaderControls.openChapter): Next / Previous to a foreign chapter opens it (the other series'
 * reader), at its start going forward, at its end going back. True when it did.
 */
export const tsujiOpenForeignChapter = (offset: 'previous' | 'next' | number): boolean => {
    if (typeof offset === 'number') {
        return false;
    }
    const { currentId, next, previous } = useForeignStore.getState();
    const target = offset === 'next' ? next : previous;
    if (!target || currentId === null || getReaderChaptersStore().currentChapter?.id !== currentId) {
        return false;
    }
    openSeriesChapter(target.path, {
        replace: true,
        resumeMode: getReaderOpenChapterResumeMode(true, offset === 'previous'),
    });
    return true;
};
