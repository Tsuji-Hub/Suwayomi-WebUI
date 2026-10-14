/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { KeyboardEvent, ReactNode } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import IconButton from '@mui/material/IconButton';
import { styled } from '@mui/material/styles';
import ChevronLeftIcon from '@mui/icons-material/ChevronLeft';
import ChevronRightIcon from '@mui/icons-material/ChevronRight';
import { useLingui } from '@lingui/react/macro';
import { REC_CARD_WIDTH } from '@/features/tsuji/recs/components/RecCard.tsx';
import { getPageScroll, getScrollEdges, getWheelScroll, toPixels } from '@/features/tsuji/recs/scrollRow.ts';

const Row = styled('div')(({ theme }) => ({
    display: 'grid',
    gridAutoFlow: 'column',
    gridAutoColumns: `${REC_CARD_WIDTH}px`,
    gap: theme.spacing(1.5),
    overflowX: 'auto',
    paddingBottom: theme.spacing(1),
    '&:focus-visible': { outline: `2px solid ${theme.palette.primary.main}`, outlineOffset: 2 },
    // Snapping only for finger swipes: with a wheel it would pull small steps back to the same card.
    '@media (pointer: coarse)': {
        scrollSnapType: 'x proximity',
        '& > *': { scrollSnapAlign: 'start' },
    },
}));

const Arrow = styled(IconButton)(({ theme }) => ({
    position: 'absolute',
    top: '40%',
    transform: 'translateY(-50%)',
    zIndex: 1,
    backgroundColor: theme.palette.background.paper,
    boxShadow: theme.shadows[3],
    opacity: 0,
    transition: theme.transitions.create('opacity'),
    '&:hover': { backgroundColor: theme.palette.background.paper },
    '.tsuji-scroll-row:hover &, .tsuji-scroll-row:focus-within &, &:focus-visible': { opacity: 1 },
    '@media (pointer: coarse)': { opacity: 1 },
}));

/**
 * A horizontal row of cards that is easy to move with a mouse: a vertical wheel scrolls it sideways (and lets the
 * page scroll once the row is at its end), edge arrows page through it, ArrowLeft/ArrowRight work when focused.
 * Touch keeps the native swipe.
 */
export const ScrollRow = ({ children, label }: { children: ReactNode; label: string }) => {
    const { t } = useLingui();
    const rowRef = useRef<HTMLDivElement>(null);
    const [edges, setEdges] = useState({ canScrollLeft: false, canScrollRight: false });

    const updateEdges = useCallback(() => {
        const row = rowRef.current;
        if (row) {
            const next = getScrollEdges(row.scrollLeft, row.clientWidth, row.scrollWidth);
            setEdges((current) =>
                current.canScrollLeft === next.canScrollLeft && current.canScrollRight === next.canScrollRight
                    ? current
                    : next,
            );
        }
    }, []);

    useEffect(() => {
        const row = rowRef.current;
        if (!row) {
            return undefined;
        }

        // Non-passive: preventDefault keeps the page still while the row moves.
        const onWheel = (event: WheelEvent) => {
            const scroll = getWheelScroll({
                deltaX: toPixels(event.deltaX, event.deltaMode, row.clientWidth),
                deltaY: toPixels(event.deltaY, event.deltaMode, row.clientWidth),
                scrollLeft: row.scrollLeft,
                maxScrollLeft: row.scrollWidth - row.clientWidth,
            });
            if (scroll !== null) {
                event.preventDefault();
                row.scrollBy({ left: scroll });
            }
        };
        const observer = new ResizeObserver(updateEdges);

        row.addEventListener('wheel', onWheel, { passive: false });
        row.addEventListener('scroll', updateEdges, { passive: true });
        observer.observe(row);
        updateEdges();

        return () => {
            row.removeEventListener('wheel', onWheel);
            row.removeEventListener('scroll', updateEdges);
            observer.disconnect();
        };
    }, [updateEdges]);

    const page = (direction: -1 | 1) => {
        const row = rowRef.current;
        if (row) {
            row.scrollBy({ left: direction * getPageScroll(row.clientWidth, REC_CARD_WIDTH), behavior: 'smooth' });
        }
    };

    const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
        if (event.target !== event.currentTarget) {
            return;
        }
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
            event.preventDefault();
            page(event.key === 'ArrowLeft' ? -1 : 1);
        }
    };

    return (
        <Box className="tsuji-scroll-row" sx={{ position: 'relative' }}>
            {edges.canScrollLeft && (
                <Arrow size="small" aria-label={t`Scroll left`} onClick={() => page(-1)} sx={{ left: 4 }}>
                    <ChevronLeftIcon />
                </Arrow>
            )}
            <Row ref={rowRef} tabIndex={0} role="group" aria-label={label} onKeyDown={onKeyDown}>
                {children}
            </Row>
            {edges.canScrollRight && (
                <Arrow size="small" aria-label={t`Scroll right`} onClick={() => page(1)} sx={{ right: 4 }}>
                    <ChevronRightIcon />
                </Arrow>
            )}
        </Box>
    );
};
