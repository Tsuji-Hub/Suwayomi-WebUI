/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/** Where a feed's first page stands. `off` = not requested (e.g. Trending known broken this session). */
export type FeedPhase = 'off' | 'pending' | 'ready' | 'empty' | 'failed';

export type LandingSource = 'loading' | 'trending' | 'popular';

/**
 * Discover landing requests Trending and Popular in parallel and shows whichever lands with results first.
 * Trending takes over later only while the user hasn't scrolled or paged the Popular grid, so nothing moves
 * under their cursor. Once Trending is shown it stays.
 */
export const pickLandingSource = ({
    current,
    trending,
    popular,
    hasScrolled,
    hasPagedPopular,
}: {
    current: LandingSource;
    trending: FeedPhase;
    popular: FeedPhase;
    hasScrolled: boolean;
    hasPagedPopular: boolean;
}): LandingSource => {
    if (current === 'trending') {
        return 'trending';
    }

    if (trending === 'ready' && (current === 'loading' || (!hasScrolled && !hasPagedPopular))) {
        return 'trending';
    }

    if (popular === 'ready') {
        return 'popular';
    }

    const isTrendingOut = trending === 'off' || trending === 'empty' || trending === 'failed';
    const isPopularDone = popular === 'empty' || popular === 'failed';

    // Neither has cards: show Popular's empty/error state (with its retry) rather than spinning forever.
    return isTrendingOut && isPopularDone ? 'popular' : current;
};
