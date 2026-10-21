/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
    ANILIST_DOWN_TTL_MS,
    ANILIST_PROBE_INTERVAL_MS,
    AniListHealth,
    isAniListDownSignal,
} from '@/features/tsuji/services/aniListHealth.ts';

describe('AniList health', () => {
    beforeEach(() => AniListHealth.reset());

    it('down: a 403 saying the API is disabled, a 5xx, a network error, 8 s without an answer', () => {
        expect(
            isAniListDownSignal({
                status: 403,
                message: 'The AniList API has been temporarily disabled due to severe stability issues.',
            }),
        ).toBe(true);
        expect(isAniListDownSignal({ status: 503 })).toBe(true);
        expect(isAniListDownSignal({ isNetworkError: true })).toBe(true);
        expect(isAniListDownSignal({ waitedMs: 12_000 })).toBe(true);
        // Not down: a plain 403, a bad query, a rate limit, a 4 s timeout (degraded AniList).
        expect(isAniListDownSignal({ status: 403, message: 'Forbidden' })).toBe(false);
        expect(isAniListDownSignal({ status: 404 })).toBe(false);
        expect(isAniListDownSignal({ status: 429 })).toBe(false);
        expect(isAniListDownSignal({ waitedMs: 4000 })).toBe(false);
    });

    it('remembered 30 minutes; one probe every 5 minutes meanwhile; back up on an answer', () => {
        AniListHealth.reportDown('disabled', 0);
        expect(AniListHealth.isDown(1)).toBe(true);
        expect(AniListHealth.claimRequest(1)).toBe('blocked');
        expect(AniListHealth.claimRequest(ANILIST_PROBE_INTERVAL_MS)).toBe('probe');
        expect(AniListHealth.claimRequest(ANILIST_PROBE_INTERVAL_MS + 1)).toBe('blocked');
        expect(AniListHealth.isDown(ANILIST_DOWN_TTL_MS)).toBe(false);
        expect(AniListHealth.claimRequest(ANILIST_DOWN_TTL_MS)).toBe('up');
        AniListHealth.reportUp();
        expect(AniListHealth.getState()).toMatchObject({ downUntil: 0, lastError: null });
    });
});
