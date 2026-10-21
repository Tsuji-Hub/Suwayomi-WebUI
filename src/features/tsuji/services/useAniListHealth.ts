/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState, useSyncExternalStore } from 'react';
import { AniListHealth } from '@/features/tsuji/services/aniListHealth.ts';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';

/** The smallest question AniList answers: is it back? */
const PROBE_QUERY = 'query TsujiProbe { Media(id: 1) { id } }';

/**
 * Whether AniList is down (brief #15), re-rendering when that changes. While down, a mounted user also sends the
 * probe when it is due (one every 5 minutes for the whole tab: the client lets only one through), so an idle page
 * notices AniList coming back.
 */
export const useAniListHealth = () => {
    const state = useSyncExternalStore(AniListHealth.subscribe, AniListHealth.getState);
    const [now, setNow] = useState(() => Date.now());
    const isDown = state.downUntil > now;

    useEffect(() => {
        if (!state.downUntil) {
            return undefined;
        }
        const due = Math.max(0, Math.min(state.downUntil, state.nextProbeAt) - Date.now());
        const timer = setTimeout(() => {
            setNow(Date.now());
            if (AniListHealth.isDown()) {
                aniList.request(PROBE_QUERY, {}, { timeoutMs: ANILIST_TIMEOUT_MS.slow }).catch(() => {});
            }
        }, due + 50);
        return () => clearTimeout(timer);
    }, [state.downUntil, state.nextProbeAt, now]);

    return { isDown, lastError: state.lastError, failedAt: state.failedAt, nextProbeAt: state.nextProbeAt };
};
