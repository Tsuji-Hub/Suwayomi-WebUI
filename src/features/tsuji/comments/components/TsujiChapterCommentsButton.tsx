/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { BaseSyntheticEvent } from 'react';
import IconButton from '@mui/material/IconButton';
import ChatBubbleOutlineIcon from '@mui/icons-material/ChatBubbleOutlineOutlined';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { TSUJI_META_KEYS } from '@/features/tsuji/Tsuji.constants.ts';
import { useTsujiGlobalMeta } from '@/features/tsuji/services/TsujiMetadata.ts';
import { openCommentsPanel } from '@/features/tsuji/comments/commentsPanelStore.ts';

// The row is a link with press / long-press handling: the button's own presses must not reach it.
const stop = (event: BaseSyntheticEvent) => event.stopPropagation();

/**
 * Comments icon on a series-page chapter row (Makimono's onChapterCommentsClicked): opens the series page's panel on
 * this chapter. Only the icon is added (no panel per row); hidden while selecting, in the reader's chapter list,
 * for chapters without a number, and while comments are off.
 */
export const TsujiChapterCommentsButton = ({
    chapter,
    mode,
    isSelecting,
}: {
    chapter: { mangaId: number; chapterNumber: number; scanlator?: string | null };
    mode: 'manga.page' | 'reader';
    isSelecting: boolean;
}) => {
    const { t } = useLingui();
    const isEnabled = useTsujiGlobalMeta()[TSUJI_META_KEYS.comments] !== 'false';

    if (!isEnabled || mode !== 'manga.page' || isSelecting || chapter.chapterNumber < 0) {
        return null;
    }

    return (
        <CustomTooltip title={t`Comments for this chapter`}>
            <IconButton
                size="small"
                aria-label={t`Comments for this chapter`}
                onMouseDown={stop}
                onTouchStart={stop}
                onPointerDown={stop}
                onContextMenu={stop}
                onClick={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    openCommentsPanel({
                        mangaId: chapter.mangaId,
                        chapterNumber: chapter.chapterNumber,
                        scanlator: chapter.scanlator ?? null,
                    });
                }}
                sx={{ color: 'inherit', alignSelf: 'center', width: 40, height: 40 }}
            >
                <ChatBubbleOutlineIcon fontSize="small" />
            </IconButton>
        </CustomTooltip>
    );
};
