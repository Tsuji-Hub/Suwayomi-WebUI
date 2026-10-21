/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { TsujiCache } from '@/features/tsuji/services/TsujiCache.ts';
import { DAY_MS } from '@/features/tsuji/Tsuji.constants.ts';
import type { TagBaseline, TasteWeights } from '@/features/tsuji/forYou/distinctive.ts';

/** What For You keeps for a month: the taste weights (Discover's Best match) and last week's pool baseline. */

const WEIGHTS_TTL_MS = 30 * DAY_MS;
const BASELINE_TTL_MS = 30 * DAY_MS;
const weightsKey = (userName: string) => `foryou:weights:v1:${userName.toLowerCase()}`;
const baselineKey = (userName: string) => `foryou:baseline:v1:${userName.toLowerCase()}`;

/** Taste weights For You last computed for the user (Discover reads them, never fetches a profile). */
export const readTasteWeights = (userName: string): TasteWeights | null => {
    const weights = TsujiCache.get<TasteWeights>(weightsKey(userName));
    return weights && Object.keys(weights).length ? weights : null;
};

export const writeTasteWeights = (userName: string, weights: TasteWeights) =>
    TsujiCache.set(weightsKey(userName), weights, WEIGHTS_TTL_MS);

/** Last week's pool baseline: this week's recall tags are picked before this week's pool exists. */
export const readPoolBaseline = (userName: string): TagBaseline | null =>
    TsujiCache.get<TagBaseline>(baselineKey(userName));

export const writePoolBaseline = (userName: string, baseline: TagBaseline) =>
    TsujiCache.set(baselineKey(userName), baseline, BASELINE_TTL_MS);
