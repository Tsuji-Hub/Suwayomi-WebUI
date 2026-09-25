/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/**
 * Raw metadata keys of the fork. They intentionally do NOT use the upstream "webUI" prefix: upstream's
 * metadata migrations delete every unregistered "webUI_*" key, but ignore other prefixes.
 */
export const TSUJI_META_KEYS = {
    libraryProgressBadge: 'tsuji_libraryProgressBadge',
    readerChapterProgress: 'tsuji_readerChapterProgress',
    recFilters: 'tsuji_recFilters',
    anilistId: 'tsuji_anilistId',
    /** AniList user whose public manga list marks titles as already read (default DEFAULT_ANILIST_USER). */
    anilistUser: 'tsuji_anilistUser',
    /** Manual marks, JSON `{ [anilistMediaId]: "read" | "skip" }`, merged on write across devices. */
    seen: 'tsuji_seen',
} as const;

export const DEFAULT_ANILIST_USER = 'ejustice';

export type TsujiMetaKey = (typeof TSUJI_META_KEYS)[keyof typeof TSUJI_META_KEYS];

/** Tracker ids as assigned by Suwayomi-Server (verified on v2.3.2243). */
export const TRACKER_ID = {
    MAL: 1,
    ANILIST: 2,
} as const;

export const DAY_MS = 24 * 60 * 60 * 1000;

export const RECS_CACHE_TTL_MS = 7 * DAY_MS;

export const MY_LIST_TTL_MS = 30 * 60 * 1000;
