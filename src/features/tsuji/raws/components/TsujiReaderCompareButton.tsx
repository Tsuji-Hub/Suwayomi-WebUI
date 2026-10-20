/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import Button from '@mui/material/Button';
import CompareIcon from '@mui/icons-material/Compare';
import { useLingui } from '@lingui/react/macro';
import { isContinuousVerticalReadingMode } from '@/features/reader/settings/ReaderSettings.utils.tsx';
import { useReaderSettingsStore } from '@/features/reader/stores/ReaderStore.ts';
import { setCompareActive, useCompareStore } from '@/features/tsuji/raws/compareStore.ts';
import { useReaderRawLinks } from '@/features/tsuji/raws/components/TsujiReaderRawLayer.tsx';

/** Desktop reader menu: Compare (English left, raw right) for series with a linked raw, in vertical modes. */
export const TsujiReaderCompareButton = () => {
    const { t } = useLingui();
    const { rawId } = useReaderRawLinks();
    const isActive = useCompareStore((state) => state.isActive);
    const readingMode = useReaderSettingsStore('readingMode').value;
    const isVertical = isContinuousVerticalReadingMode(readingMode);

    if (!rawId || !isVertical) {
        return null;
    }

    return (
        <Button
            size="small"
            variant={isActive ? 'contained' : 'outlined'}
            startIcon={<CompareIcon fontSize="small" />}
            aria-pressed={isActive}
            onClick={() => setCompareActive(!isActive)}
        >
            {isActive ? t`Compare: on` : t`Compare with raw`}
        </Button>
    );
};
