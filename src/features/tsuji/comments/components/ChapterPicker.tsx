/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import Drawer from '@mui/material/Drawer';
import ListItemButton from '@mui/material/ListItemButton';
import ListItemText from '@mui/material/ListItemText';
import { Virtuoso } from 'react-virtuoso';
import { useLingui } from '@lingui/react/macro';
import type { CommentChapter } from '@/features/tsuji/comments/chapterNav.ts';
import { getPickerIndex } from '@/features/tsuji/comments/chapterNav.ts';

/** The chapter list, virtualized, opened with the current chapter in the middle. */
const ChapterList = ({
    chapters,
    current,
    onPick,
}: {
    chapters: CommentChapter[];
    current: number;
    onPick: (chapterNumber: number) => void;
}) => {
    const { t } = useLingui();
    const [scrollParent, setScrollParent] = useState<HTMLElement | null>(null);

    return (
        <Box
            ref={setScrollParent}
            role="listbox"
            aria-label={t`Chapters`}
            sx={{ height: { xs: '60vh', md: 480 }, overflowY: 'auto' }}
        >
            {scrollParent && (
                <Virtuoso
                    customScrollParent={scrollParent}
                    data={chapters}
                    initialTopMostItemIndex={{ index: getPickerIndex(chapters, current), align: 'center' }}
                    computeItemKey={(_, chapter) => chapter.number}
                    itemContent={(_, chapter) => (
                        <ListItemButton
                            role="option"
                            aria-selected={chapter.number === current}
                            selected={chapter.number === current}
                            onClick={() => onPick(chapter.number)}
                        >
                            <ListItemText primary={chapter.label} slotProps={{ primary: { noWrap: true } }} />
                        </ListItemButton>
                    )}
                />
            )}
        </Box>
    );
};

/** "Choose chapter": a dialog on wide screens, a bottom sheet below 900 px. Escape closes it. */
export const ChapterPicker = ({
    chapters,
    current,
    isOpen,
    isDesktop,
    onClose,
    onPick,
}: {
    chapters: CommentChapter[];
    current: number;
    isOpen: boolean;
    isDesktop: boolean;
    onClose: () => void;
    onPick: (chapterNumber: number) => void;
}) => {
    const { t } = useLingui();
    const list = <ChapterList chapters={chapters} current={current} onPick={onPick} />;

    return isDesktop ? (
        <Dialog open={isOpen} onClose={onClose} maxWidth="xs" fullWidth aria-label={t`Choose chapter`}>
            <DialogTitle>{t`Choose chapter`}</DialogTitle>
            {list}
        </Dialog>
    ) : (
        <Drawer
            anchor="bottom"
            open={isOpen}
            onClose={onClose}
            slotProps={{
                paper: {
                    role: 'dialog',
                    'aria-label': t`Choose chapter`,
                    sx: { borderTopLeftRadius: 12, borderTopRightRadius: 12 },
                },
            }}
        >
            <DialogTitle>{t`Choose chapter`}</DialogTitle>
            {list}
        </Drawer>
    );
};
