/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { RefObject } from 'react';
import { useEffect, useState } from 'react';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { getAllTitles } from '@/features/tsuji/recs/media.ts';
import type { Freshness } from '@/features/tsuji/recs/mergedScore.ts';
import { getFreshness, isOngoingStatus } from '@/features/tsuji/recs/mergedScore.ts';
import { loadComickFreshness } from '@/features/tsuji/comick/ComickService.ts';

/** How close to the screen a card is before its date is looked up. */
const NEAR_SCREEN = '300px';

/**
 * The freshness tag of an ongoing card (brief #21): from the card's own latest chapter date (Comick cards), else, for
 * an AniList card once it is near the screen, one Comick lookup a day (never before the rail has rendered, nothing for
 * a finished series).
 */
export const useCardFreshness = (media: RecMedia, ref: RefObject<HTMLElement | null>): Freshness => {
    const isOngoing = isOngoingStatus(media.status);
    const needsLookup = isOngoing && !media.lastChapterAt && media.id > 0 && media.via !== 'comick';
    const [looked, setLooked] = useState<{ id: number; at: number | null } | null>(null);
    const titlesKey = needsLookup ? getAllTitles(media).join('\n') : '';

    useEffect(() => {
        const element = ref.current;
        if (!needsLookup || !element || looked?.id === media.id) {
            return undefined;
        }
        const controller = new AbortController();
        const observer = new IntersectionObserver(
            (entries) => {
                if (!entries.some(({ isIntersecting }) => isIntersecting)) {
                    return;
                }
                observer.disconnect();
                loadComickFreshness(media.id, titlesKey.split('\n'), controller.signal)
                    .then(
                        (info) =>
                            !controller.signal.aborted && setLooked({ id: media.id, at: info?.lastChapterAt ?? null }),
                    )
                    .catch(() => {
                        // No tag: Comick didn't answer.
                    });
            },
            { rootMargin: NEAR_SCREEN },
        );
        observer.observe(element);
        return () => {
            observer.disconnect();
            controller.abort();
        };
    }, [needsLookup, media.id, titlesKey]);

    if (!isOngoing) {
        return null;
    }
    return getFreshness(media.lastChapterAt ?? (looked?.id === media.id ? looked.at : null));
};
