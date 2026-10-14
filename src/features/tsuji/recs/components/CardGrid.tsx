/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import { styled, useTheme } from '@mui/material/styles';
import { useLingui } from '@lingui/react/macro';
import { REC_CARD_WIDTH } from '@/features/tsuji/recs/components/RecCard.tsx';
import { getGridCap } from '@/features/tsuji/recs/scrollRow.ts';

const GAP_SPACING = 1.5;

const Grid = styled('div')(({ theme }) => ({
    display: 'grid',
    gridTemplateColumns: `repeat(auto-fill, ${REC_CARD_WIDTH}px)`,
    gap: theme.spacing(GAP_SPACING),
    justifyContent: 'start',
}));

/** Wrapped cards, capped at 24 and 4 rows at the current width, with More for the rest. */
export const CappedCardGrid = <T,>({ items, renderItem }: { items: T[]; renderItem: (item: T) => ReactNode }) => {
    const { t } = useLingui();
    const theme = useTheme();
    const gridRef = useRef<HTMLDivElement>(null);
    const [cap, setCap] = useState<number>(Number.POSITIVE_INFINITY);
    const [isExpanded, setIsExpanded] = useState(false);
    const gap = Number.parseFloat(theme.spacing(GAP_SPACING));

    const measure = useCallback(() => {
        const width = gridRef.current?.clientWidth;
        if (width) {
            setCap(getGridCap(width, REC_CARD_WIDTH, gap));
        }
    }, [gap]);

    useEffect(() => {
        const grid = gridRef.current;
        if (!grid) {
            return undefined;
        }
        const observer = new ResizeObserver(measure);
        observer.observe(grid);
        measure();
        return () => observer.disconnect();
    }, [measure]);

    const visible = isExpanded ? items : items.slice(0, cap);
    const hiddenCount = items.length - visible.length;

    return (
        <Stack sx={{ gap: 1 }}>
            <Grid ref={gridRef}>{visible.map(renderItem)}</Grid>
            {hiddenCount > 0 && (
                <Button size="small" onClick={() => setIsExpanded(true)} sx={{ alignSelf: 'flex-start' }}>
                    {t`More (${hiddenCount})`}
                </Button>
            )}
        </Stack>
    );
};
