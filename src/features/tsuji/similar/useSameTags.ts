/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useRef, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import { loadSameTags } from '@/features/tsuji/similar/SameTagsService.ts';

/**
 * The "Same tags as" fill for an AniList id, loaded only once it is needed (and kept for that id after); null
 * until then, or when it failed. It searches until `needed` cards pass `isVisible` (Similar's hide rules).
 */
export const useSameTags = (
    anilistId: number | null,
    isNeeded: boolean,
    needed: number,
    isVisible: (media: RecMedia) => boolean,
): RecMedia[] | null => {
    const [result, setResult] = useState<{ anilistId: number; items: RecMedia[] } | null>(null);
    const hasResult = result?.anilistId === anilistId;
    const isVisibleRef = useRef(isVisible);
    isVisibleRef.current = isVisible;
    const neededRef = useRef(needed);
    neededRef.current = needed;

    useEffect(() => {
        if (anilistId === null || !isNeeded || hasResult) {
            return undefined;
        }
        const controller = new AbortController();
        loadSameTags({
            anilistId,
            needed: neededRef.current,
            isVisible: (media) => isVisibleRef.current(media),
            signal: controller.signal,
        })
            .then(({ items }) => !controller.signal.aborted && setResult({ anilistId, items }))
            .catch((error) => !controller.signal.aborted && defaultPromiseErrorHandler('useSameTags')(error));
        return () => controller.abort();
    }, [anilistId, isNeeded, hasResult]);

    return hasResult ? result.items : null;
};
