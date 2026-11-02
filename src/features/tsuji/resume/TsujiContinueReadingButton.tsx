/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { ComponentProps, MouseEvent } from 'react';
import { useCallback, useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { Link, useNavigate } from 'react-router-dom';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { Chapters } from '@/features/chapter/services/Chapters.ts';
import { MUIUtil } from '@/lib/mui/MUI.util.ts';
import type { ContinueReadingButton } from '@/features/manga/components/ContinueReadingButton.tsx';
import { ContinueReadingTooltip } from '@/features/manga/components/ContinueReadingTooltip.tsx';
import type { LibraryResume } from '@/features/tsuji/resume/libraryResume.ts';
import { loadLibraryResume } from '@/features/tsuji/resume/libraryResume.ts';

type ServerChapter = NonNullable<ComponentProps<typeof ContinueReadingButton>['chapter']>;

/**
 * The library card's Play button (upstream `ContinueReadingButton`) opening the chapter the series page's Resume opens:
 * resolved on hover / focus (so the tooltip names it) or on click (a small spinner while it loads). The server's first
 * unread chapter when the lookup fails; the series page when every chapter has a read copy.
 */
export const TsujiContinueReadingButton = ({
    showContinueReadingButton,
    mangaId,
    chapter: serverChapter,
    mangaLinkTo,
}: {
    showContinueReadingButton: boolean;
    mangaId: number;
    chapter?: ServerChapter | null;
    mangaLinkTo: string;
}) => {
    const { t } = useLingui();
    const navigate = useNavigate();
    const [resume, setResume] = useState<LibraryResume | null>(null);
    const [isWaiting, setIsWaiting] = useState(false);

    const resolve = useCallback(
        () =>
            loadLibraryResume(mangaId).then((result) => {
                setResume(result);
                return result;
            }),
        [mangaId],
    );

    if (!showContinueReadingButton || !serverChapter) {
        return null;
    }

    const target = resume && resume !== 'error' ? resume.chapter : serverChapter;
    const href = target ? Chapters.getReaderUrl({ mangaId, sourceOrder: target.sourceOrder }) : mangaLinkTo;
    const state = target ? Chapters.getReaderOpenChapterLocationState(target) : undefined;

    const open = (result: LibraryResume) => {
        const chapter = result === 'error' ? serverChapter : result.chapter;
        if (!chapter) {
            navigate(mangaLinkTo);
            return;
        }
        navigate(Chapters.getReaderUrl({ mangaId, sourceOrder: chapter.sourceOrder }), {
            state: Chapters.getReaderOpenChapterLocationState(chapter),
        });
    };

    const onClick = (event: MouseEvent) => {
        event.stopPropagation();
        // A new tab / window keeps the link as it stands.
        if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) {
            return;
        }
        event.preventDefault();
        setIsWaiting(true);
        resolve()
            .then(open)
            .finally(() => setIsWaiting(false));
    };

    const button = (
        <Button
            {...MUIUtil.preventRippleProp()}
            variant="contained"
            size="small"
            sx={{ minWidth: 'unset', py: 0.5, px: 0.75 }}
            component={Link}
            to={href}
            state={state}
            onClick={onClick}
            onPointerEnter={() => {
                resolve();
            }}
            onFocus={() => {
                resolve();
            }}
            aria-busy={isWaiting}
        >
            {isWaiting ? <CircularProgress size={24} color="inherit" /> : <PlayArrowIcon />}
        </Button>
    );

    if (!target) {
        return <CustomTooltip title={t`Every chapter is read: open the series`}>{button}</CustomTooltip>;
    }
    return (
        <ContinueReadingTooltip
            chapterNumber={target.chapterNumber}
            name={target.name}
            sourceOrder={target.sourceOrder}
            scanlator={target.scanlator}
        >
            {button}
        </ContinueReadingTooltip>
    );
};
