/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useMemo } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { useDeviceContext } from '@/features/device/DeviceContext.tsx';
import { HOTKEY_SCOPES } from '@/features/hotkeys/Hotkeys.constants.ts';
import type { TsujiMetaKey } from '@/features/tsuji/Tsuji.constants.ts';
import { useCompareStore } from '@/features/tsuji/raws/compareStore.ts';
import { setTsujiGlobalMeta, useTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import type { PagePosition } from '@/features/tsuji/reader/position/pagePosition.ts';
import {
    getNextPagePosition,
    getPagePositionMetaKey,
    PAGE_EDGE_OFFSET_KEY,
    PAGE_POSITION_KEY,
    parsePageEdgeOffset,
    parsePagePosition,
} from '@/features/tsuji/reader/position/pagePosition.ts';

export const usePagePosition = () => {
    const { activeDevice } = useDeviceContext();
    const meta = useTsujiGlobalMeta() as Record<string, string | undefined>;
    const positionKey = getPagePositionMetaKey(PAGE_POSITION_KEY, activeDevice);
    const offsetKey = getPagePositionMetaKey(PAGE_EDGE_OFFSET_KEY, activeDevice);
    const position = parsePagePosition(meta[positionKey]);
    const isCompare = useCompareStore((state) => state.isActive);
    const offset = parsePageEdgeOffset(meta[offsetKey]);

    // Device-prefixed keys aren't in TSUJI_META_KEYS; they are raw tsuji_* keys all the same.
    const setPosition = useCallback(
        (value: PagePosition) => setTsujiGlobalMeta(positionKey as TsujiMetaKey, value),
        [positionKey],
    );
    const setOffset = useCallback(
        (value: number) => setTsujiGlobalMeta(offsetKey as TsujiMetaKey, String(parsePageEdgeOffset(value))),
        [offsetKey],
    );

    return useMemo(
        () => ({ position, offset, isCompare, setPosition, setOffset }),
        [position, offset, isCompare, setPosition, setOffset],
    );
};

/** Shift+L cycles Left -> Center -> Right in the reader (the owner's bookmarklet key; unused by the reader). */
export const useTsujiPagePositionHotkey = () => {
    const { position, setPosition } = usePagePosition();
    useHotkeys(
        'shift+l',
        () => setPosition(getNextPagePosition(position)),
        { preventDefault: true, ...HOTKEY_SCOPES.reader },
        [position, setPosition],
    );
};
