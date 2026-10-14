/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import Button from '@mui/material/Button';
import IconButton from '@mui/material/IconButton';
import CommentOutlinedIcon from '@mui/icons-material/CommentOutlined';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { useReaderChaptersStore, useReaderStore } from '@/features/reader/stores/ReaderStore.ts';
import { CommentsPanel } from '@/features/tsuji/comments/components/CommentsPanel.tsx';
import { useCommentsSettings } from '@/features/tsuji/comments/useComments.ts';

/** Series view: the first chapter's discussion (never later chapters, no spoilers). */
const SERIES_CHAPTER = 1;

/** "Comments" pill next to the Similar header; opens chapter 1's Comick thread. Hidden while comments are off. */
export const CommentsPill = ({ manga }: { manga: { id: number; title: string } }) => {
    const { t } = useLingui();
    const settings = useCommentsSettings();
    const [isOpen, setIsOpen] = useState(false);

    if (settings.isLoading || !settings.isEnabled) {
        return null;
    }

    return (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<CommentOutlinedIcon fontSize="small" />}
                onClick={() => setIsOpen(true)}
                sx={{ borderRadius: 999, py: 0 }}
            >
                {t`Comments`}
            </Button>
            <CommentsPanel
                target={{ manga, chapterNumber: SERIES_CHAPTER }}
                isOpen={isOpen}
                onClose={() => setIsOpen(false)}
            />
        </>
    );
};

/** Reader: comments of the chapter being read. `desktop` is a text button in the nav bar, `mobile` an icon. */
export const TsujiReaderCommentsButton = ({ variant }: { variant: 'desktop' | 'mobile' }) => {
    const { t } = useLingui();
    const settings = useCommentsSettings();
    const manga = useReaderStore('manga');
    const chapterNumber = useReaderChaptersStore((state) => state.currentChapter?.chapterNumber);
    const [isOpen, setIsOpen] = useState(false);

    if (settings.isLoading || !settings.isEnabled || !manga || chapterNumber === undefined) {
        return null;
    }

    const panel = (
        <CommentsPanel
            target={{ manga: { id: manga.id, title: manga.title }, chapterNumber }}
            isOpen={isOpen}
            onClose={() => setIsOpen(false)}
        />
    );

    return variant === 'desktop' ? (
        <>
            <Button
                size="small"
                variant="outlined"
                startIcon={<CommentOutlinedIcon fontSize="small" />}
                onClick={() => setIsOpen(true)}
            >
                {t`Comments`}
            </Button>
            {panel}
        </>
    ) : (
        <>
            <CustomTooltip title={t`Comments`}>
                <IconButton onClick={() => setIsOpen(true)} color="inherit" aria-label={t`Comments`}>
                    <CommentOutlinedIcon />
                </IconButton>
            </CustomTooltip>
            {panel}
        </>
    );
};
