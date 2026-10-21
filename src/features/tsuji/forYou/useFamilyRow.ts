/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import type { ForYouData } from '@/features/tsuji/forYou/ForYouService.ts';
import type { FamilyRowData } from '@/features/tsuji/forYou/FamilyRowService.ts';
import { loadFamilyRow } from '@/features/tsuji/forYou/FamilyRowService.ts';

/** This week's "More <Family>" row, loaded once the week is in (null while loading, or when it failed). */
export const useFamilyRow = (userName: string, data: ForYouData | null): FamilyRowData | null => {
    const [result, setResult] = useState<{ weekKey: string; row: FamilyRowData } | null>(null);

    useEffect(() => {
        if (!data?.familySeeds?.length) {
            return undefined;
        }
        const controller = new AbortController();
        loadFamilyRow({ userName, data, signal: controller.signal })
            .then((row) => !controller.signal.aborted && setResult({ weekKey: data.weekKey, row }))
            .catch((error) => !controller.signal.aborted && defaultPromiseErrorHandler('useFamilyRow')(error));
        return () => controller.abort();
    }, [userName, data]);

    return result && result.weekKey === data?.weekKey ? result.row : null;
};
