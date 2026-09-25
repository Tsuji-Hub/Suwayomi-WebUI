/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import type { MessageDescriptor } from '@lingui/core';
import { msg } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import { TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import type { SeenBadgeKind, SeenMark, SeenState } from '@/features/tsuji/seen/seen.ts';
import { getSeenBadge } from '@/features/tsuji/seen/seen.ts';

const SEEN_BADGES: Record<SeenBadgeKind, { label: MessageDescriptor; color: string }> = {
    completed: { label: msg`Completed`, color: TSUJI_PALETTE.statusComplete },
    reading: { label: msg`Reading`, color: TSUJI_PALETTE.statusOngoing },
    rereading: { label: msg`Rereading`, color: TSUJI_PALETTE.statusOngoing },
    dropped: { label: msg`Dropped`, color: TSUJI_PALETTE.statusPaused },
    paused: { label: msg`Paused`, color: TSUJI_PALETTE.statusPaused },
    planned: { label: msg`Planned`, color: 'info.main' },
    read: { label: msg`Read`, color: TSUJI_PALETTE.statusComplete },
    skip: { label: msg`Not interested`, color: TSUJI_PALETTE.statusPaused },
};

/** "Completed", "Reading 45/120", "Planned", "Not interested"... or null when the title isn't on the list. */
export const useSeenBadge = (state: SeenState | null | undefined, chapters: number | null) => {
    const { t } = useLingui();
    const badge = getSeenBadge(state ?? null, chapters);

    if (!badge) {
        return null;
    }

    const { label, color } = SEEN_BADGES[badge.kind];
    const name = t(label);

    const text = (() => {
        if (badge.progress === null) {
            return name;
        }
        return badge.total === null ? `${name} ${badge.progress}` : `${name} ${badge.progress}/${badge.total}`;
    })();

    return { text, color };
};

export type OnSeenMark = (media: RecMedia, mark: SeenMark | null) => void;

/** Card overflow: Mark as read / Not interested (or Unhide for a manual mark), plus Details. */
export const RecCardMenu = ({
    media,
    seenState,
    onMark,
    onPreview,
}: {
    media: RecMedia;
    seenState: SeenState | null | undefined;
    onMark: OnSeenMark;
    onPreview: (media: RecMedia) => void;
}) => {
    const { t } = useLingui();
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);

    const run = (action: () => void) => () => {
        setAnchor(null);
        action();
    };

    const markItems =
        seenState?.source === 'mark'
            ? [
                  <MenuItem key="unhide" onClick={run(() => onMark(media, null))}>
                      {t`Unhide`}
                  </MenuItem>,
              ]
            : [
                  <MenuItem key="read" onClick={run(() => onMark(media, 'read'))}>
                      {t`Mark as read`}
                  </MenuItem>,
                  <MenuItem key="skip" onClick={run(() => onMark(media, 'skip'))}>
                      {t`Not interested`}
                  </MenuItem>,
              ];

    return (
        <>
            <IconButton
                size="small"
                aria-label={t`More actions`}
                onClick={(event) => setAnchor(event.currentTarget)}
                sx={{ ml: 'auto', p: 0.25 }}
            >
                <MoreVertIcon fontSize="small" />
            </IconButton>
            <Menu anchorEl={anchor} open={!!anchor} onClose={() => setAnchor(null)}>
                {markItems}
                <MenuItem onClick={run(() => onPreview(media))}>{t`Details`}</MenuItem>
            </Menu>
        </>
    );
};
