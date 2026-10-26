/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import type { DropBand } from '@/features/tsuji/drops/drops.ts';

/** Drop rate colours: low / typical / high vs the library median. */
export const DROP_BAND_COLOR: Record<DropBand, string> = {
    low: TSUJI_PALETTE.dropLow,
    typical: TSUJI_PALETTE.dropTypical,
    high: TSUJI_PALETTE.dropHigh,
};
