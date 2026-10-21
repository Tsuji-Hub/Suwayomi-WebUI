/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import type { ListTitleIndex } from '@/features/tsuji/seen/myList.ts';

/** The title index of the last list AniList gave (brief #15), kept a month like the list itself. */
const titlesKey = (userName: string) => `myList:titles:v1:${userName.toLowerCase()}`;
const TITLES_TTL_MS = 30 * DAY_MS;

/** Title -> AniList id of the last known list (for cards from Comick), or null before any list was loaded. */
export const readListTitleIndex = (userName: string): ListTitleIndex | null =>
    TsujiCache.get<ListTitleIndex>(titlesKey(userName));

export const writeListTitleIndex = (userName: string, index: ListTitleIndex) =>
    TsujiCache.set(titlesKey(userName), index, TITLES_TTL_MS);
