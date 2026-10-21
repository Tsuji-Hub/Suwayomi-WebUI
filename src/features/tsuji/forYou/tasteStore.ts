/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { TasteWeights } from '@/features/tsuji/forYou/distinctive.ts';

/** The taste weights For You last computed, kept a month: Discover's Best match reads them. */
const WEIGHTS_TTL_MS = 30 * DAY_MS;
const weightsKey = (userName: string) => `foryou:weights:v2:${userName.toLowerCase()}`;

/** Taste weights For You last computed for the user (Discover reads them, never fetches a profile). */
export const readTasteWeights = (userName: string): TasteWeights | null => {
    const weights = TsujiCache.get<TasteWeights>(weightsKey(userName));
    return weights && Object.keys(weights).length ? weights : null;
};

export const writeTasteWeights = (userName: string, weights: TasteWeights) =>
    TsujiCache.set(weightsKey(userName), weights, WEIGHTS_TTL_MS);
