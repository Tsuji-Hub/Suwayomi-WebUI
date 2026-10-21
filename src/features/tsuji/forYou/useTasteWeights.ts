/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useMemo } from 'react';
import { DEFAULT_ANILIST_USER, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { useTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import type { TasteWeights } from '@/features/tsuji/forYou/distinctive.ts';
import { readTasteWeights } from '@/features/tsuji/forYou/tasteStore.ts';

/**
 * The taste weights For You last computed for the configured AniList user, from the cache only (never a request);
 * null when For You hasn't built a profile on this browser. Read again when `refreshKey` changes.
 */
export const useTasteWeights = (refreshKey?: unknown): TasteWeights | null => {
    const userName = useTsujiGlobalMeta()[TSUJI_META_KEYS.anilistUser]?.trim() || DEFAULT_ANILIST_USER;
    // oxlint-disable-next-line react-hooks/exhaustive-deps
    return useMemo(() => readTasteWeights(userName), [userName, refreshKey]);
};
