/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useState } from 'react';
import { AppStorage } from '@/lib/storage/AppStorage.ts';

/**
 * State that survives navigating away and back within the tab (e.g. Discover -> global search -> back).
 * Falls back to plain component state when sessionStorage is unavailable.
 */
export const useSessionState = <T>(key: string, fallback: T): [T, (value: T) => void] => {
    const storageKey = `tsuji:${key}`;

    const [value, setValue] = useState<T>(() => {
        try {
            return AppStorage.session.getItemParsed<T>(storageKey, fallback) ?? fallback;
        } catch {
            return fallback;
        }
    });

    const update = useCallback(
        (next: T) => {
            setValue(next);
            try {
                AppStorage.session.setItem(storageKey, next, false);
            } catch {
                // Storage unavailable: in-memory state only.
            }
        },
        [storageKey],
    );

    return [value, update];
};
