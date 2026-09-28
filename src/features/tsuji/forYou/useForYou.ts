/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { defaultPromiseErrorHandler } from '@/lib/DefaultPromiseErrorHandler.ts';
import { DEFAULT_ANILIST_USER, TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import type { ForYouData } from '@/features/tsuji/forYou/ForYouService.ts';
import { loadForYou } from '@/features/tsuji/forYou/ForYouService.ts';
import { useTsujiGlobalMetaQuery } from '@/features/tsuji/services/TsujiMetadata.ts';

export type ForYouState =
    | { status: 'loading' }
    | { status: 'empty'; entryCount: number }
    | { status: 'error' }
    | { status: 'ready'; data: ForYouData };

const LOADING: ForYouState = { status: 'loading' };

/** This week's For You for the configured AniList user (`tsuji_anilistUser`); waits for global meta first. */
export const useForYou = () => {
    const { meta, isLoading: isMetaLoading } = useTsujiGlobalMetaQuery();
    const userName = meta[TSUJI_META_KEYS.anilistUser]?.trim() || DEFAULT_ANILIST_USER;
    const [result, setResult] = useState<{ userName: string; state: ForYouState }>({ userName, state: LOADING });
    const [reloadCount, setReloadCount] = useState(0);
    const shouldForceRef = useRef(false);

    useEffect(() => {
        if (isMetaLoading) {
            return undefined;
        }

        const controller = new AbortController();
        const { signal } = controller;
        const force = shouldForceRef.current;
        shouldForceRef.current = false;
        setResult({ userName, state: LOADING });

        loadForYou({ userName, force, signal })
            .then((loaded) => {
                if (!signal.aborted) {
                    setResult({
                        userName,
                        state:
                            loaded.kind === 'ready'
                                ? { status: 'ready', data: loaded.data }
                                : { status: 'empty', entryCount: loaded.entryCount },
                    });
                }
            })
            .catch((error) => {
                if (signal.aborted) {
                    return;
                }
                defaultPromiseErrorHandler('useForYou')(error);
                setResult({ userName, state: { status: 'error' } });
            });

        return () => controller.abort();
    }, [userName, isMetaLoading, reloadCount]);

    const retry = useCallback(() => setReloadCount((count) => count + 1), []);
    const refresh = useCallback(() => {
        shouldForceRef.current = true;
        setReloadCount((count) => count + 1);
    }, []);

    return { state: result.userName === userName ? result.state : LOADING, userName, retry, refresh };
};
