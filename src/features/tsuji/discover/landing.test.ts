/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { describe, expect, it } from 'vitest';
import type { FeedPhase, LandingSource } from '@/features/tsuji/discover/landing.ts';
import { pickLandingSource } from '@/features/tsuji/discover/landing.ts';

const pick = (
    current: LandingSource,
    trending: FeedPhase,
    popular: FeedPhase,
    { hasScrolled = false, hasPagedPopular = false } = {},
) => pickLandingSource({ current, trending, popular, hasScrolled, hasPagedPopular });

describe('pickLandingSource (parallel Trending + Popular)', () => {
    it('waits while both are pending', () => expect(pick('loading', 'pending', 'pending')).toBe('loading'));

    it('shows Popular as soon as it lands, even while Trending is still pending', () =>
        expect(pick('loading', 'pending', 'ready')).toBe('popular'));

    it('prefers Trending when both are ready', () => expect(pick('loading', 'ready', 'ready')).toBe('trending'));

    it('swaps to Trending when it arrives later and the user has not scrolled', () =>
        expect(pick('popular', 'ready', 'ready')).toBe('trending'));

    it('keeps Popular once the user scrolled or paged it', () => {
        expect(pick('popular', 'ready', 'ready', { hasScrolled: true })).toBe('popular');
        expect(pick('popular', 'ready', 'ready', { hasPagedPopular: true })).toBe('popular');
    });

    it('stays on Popular when Trending is empty, failed or known broken', () => {
        expect(pick('popular', 'empty', 'ready')).toBe('popular');
        expect(pick('loading', 'failed', 'ready')).toBe('popular');
        expect(pick('loading', 'off', 'ready')).toBe('popular');
    });

    it('never leaves Trending once shown', () => expect(pick('trending', 'ready', 'failed')).toBe('trending'));

    it("falls to Popular's empty/error state when nothing has cards", () => {
        expect(pick('loading', 'failed', 'failed')).toBe('popular');
        expect(pick('loading', 'off', 'empty')).toBe('popular');
        expect(pick('loading', 'failed', 'pending')).toBe('loading');
    });
});
