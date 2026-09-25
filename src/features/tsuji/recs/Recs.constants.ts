/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import type { ComicType, RecMediaStatus } from '@/features/tsuji/recs/Recs.types.ts';
import type { RecSort } from '@/features/tsuji/recs/filters.ts';

export const STATUS_BADGES: Record<RecMediaStatus, { label: MessageDescriptor; color: string }> = {
    RELEASING: { label: msg`Ongoing`, color: TSUJI_PALETTE.statusOngoing },
    FINISHED: { label: msg`Complete`, color: TSUJI_PALETTE.statusComplete },
    HIATUS: { label: msg`Hiatus`, color: TSUJI_PALETTE.statusHiatus },
    CANCELLED: { label: msg`Cancelled`, color: TSUJI_PALETTE.statusCancelled },
    NOT_YET_RELEASED: { label: msg`Upcoming`, color: TSUJI_PALETTE.statusUpcoming },
};

export const getStatusBadge = (status: string | null | undefined) =>
    status && status in STATUS_BADGES ? STATUS_BADGES[status as RecMediaStatus] : null;

export const COMIC_TYPE_LABELS: Record<ComicType, MessageDescriptor> = {
    MANHWA: msg`Manhwa`,
    MANGA: msg`Manga`,
    MANHUA: msg`Manhua`,
};

export const REC_SORT_LABELS: Record<RecSort, MessageDescriptor> = {
    BEST: msg`Best match`,
    SCORE: msg`Top rated`,
    POPULARITY: msg`Most popular`,
    NEWEST: msg`Newest`,
};
