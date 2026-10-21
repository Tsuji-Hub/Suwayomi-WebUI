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
import type { ForYouData } from '@/features/tsuji/forYou/ForYouService.ts';
import type { FamilyRowData } from '@/features/tsuji/forYou/FamilyRowService.ts';
import { loadFamilyRow } from '@/features/tsuji/forYou/FamilyRowService.ts';

/** After the cards show, so the row's lookups never hold up the first ones. */
const START_DELAY_MS = 1000;

/**
 * This week's "More <Family>" row: built once the week's cards are on screen (`isReady`), shown in the same visit
 * as soon as it is in; null until then, or when it failed. `isVisible` is the tab's hide rules (the latest one is
 * used while the row pages for enough cards).
 */
export const useFamilyRow = (
    userName: string,
    data: ForYouData | null,
    isReady: boolean,
    isVisible: (media: RecMedia) => boolean,
): FamilyRowData | null => {
    const [result, setResult] = useState<{ weekKey: string; row: FamilyRowData } | null>(null);
    const isVisibleRef = useRef(isVisible);
    isVisibleRef.current = isVisible;

    useEffect(() => {
        if (!isReady || !data?.familySeeds?.length) {
            return undefined;
        }
        let isCurrent = true;
        const timer = setTimeout(() => {
            loadFamilyRow({ userName, data, isVisible: (media) => isVisibleRef.current(media) })
                .then((row) => isCurrent && setResult({ weekKey: data.weekKey, row }))
                .catch((error) => isCurrent && defaultPromiseErrorHandler('useFamilyRow')(error));
        }, START_DELAY_MS);
        return () => {
            isCurrent = false;
            clearTimeout(timer);
        };
    }, [userName, data, isReady]);

    return result && result.weekKey === data?.weekKey ? result.row : null;
};
