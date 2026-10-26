/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { LibraryOptions } from '@/features/library/Library.types.ts';
import type { DropIndex } from '@/features/tsuji/drops/drops.ts';
import { sortByDropRate } from '@/features/tsuji/drops/drops.ts';

/**
 * Upstream hook (useGetVisibleLibraryMangas): the "Drop rate" sort (brief #20) on top of upstream's sort (titles for
 * an unknown mode), from the relay's index; other sorts pass through.
 */
export const tsujiSortLibrary = <T>(
    mangas: T[],
    { sortBy, sortDesc }: Pick<LibraryOptions, 'sortBy' | 'sortDesc'>,
    index: DropIndex | null,
): T[] =>
    sortBy === 'tsujiDropRate'
        ? (sortByDropRate(mangas as Parameters<typeof sortByDropRate>[0], index, !!sortDesc) as T[])
        : mangas;
