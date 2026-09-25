/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/** The fork's one named palette (values match Makimono's RecommendStyle.kt). */
export const TSUJI_PALETTE = {
    scoreHigh: '#66BB6A',
    scoreMid: '#FFCA28',
    scoreLow: '#BDBDBD',
    statusOngoing: '#42A5F5',
    statusComplete: '#66BB6A',
    statusHiatus: '#FFCA28',
    statusCancelled: '#EF5350',
    statusUpcoming: '#BDBDBD',
    badgeScrim: 'rgba(0, 0, 0, 0.6)',
    badgeText: '#FFFFFF',
    progressBadge: '#424242',
} as const;

/** Motion tokens: strong ease-out for press feedback and small UI transitions. */
export const TSUJI_MOTION = {
    easeOut: 'cubic-bezier(0.23, 1, 0.32, 1)',
    pressMs: 160,
} as const;

export const getScoreColor = (score: number): string => {
    if (score >= 75) {
        return TSUJI_PALETTE.scoreHigh;
    }

    if (score >= 60) {
        return TSUJI_PALETTE.scoreMid;
    }

    return TSUJI_PALETTE.scoreLow;
};
