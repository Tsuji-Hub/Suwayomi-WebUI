/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import { getRelativeTime } from '@/features/tsuji/bell/chapterBell.ts';

/**
 * Quiet one-liner when the AniList list can't load: with a saved copy (brief #17), how old the copy hiding titles
 * is; with none, that nothing is hidden. Nothing while the live list is in use.
 */
export const MyListNotice = ({
    myList: { userName, savedAt, isUnavailable, refresh },
}: {
    myList: { userName: string; savedAt: number | null; isUnavailable: boolean; refresh: () => void };
}) => {
    const { t, i18n } = useLingui();
    if (!savedAt && !isUnavailable) {
        return null;
    }
    let message = t`Couldn't load ${userName}'s AniList list, so nothing is hidden.`;
    if (savedAt) {
        const { value, unit } = getRelativeTime(savedAt / 1000, Date.now());
        const savedWhen = new Intl.RelativeTimeFormat(i18n.locale, { numeric: 'auto' }).format(value, unit);
        message = t`AniList is down: hiding titles from your saved list (${savedWhen}).`;
    }

    return (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {message}
            </Typography>
            <Button size="small" onClick={refresh}>
                {t`Retry`}
            </Button>
        </Stack>
    );
};
