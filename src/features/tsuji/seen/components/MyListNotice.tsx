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

/** Quiet one-liner when the AniList list can't load: everything stays visible. */
export const MyListNotice = ({ userName, onRetry }: { userName: string; onRetry: () => void }) => {
    const { t } = useLingui();

    return (
        <Stack direction="row" sx={{ alignItems: 'center', gap: 1 }}>
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                {t`Couldn't load ${userName}'s AniList list, so nothing is hidden.`}
            </Typography>
            <Button size="small" onClick={onRetry}>
                {t`Retry`}
            </Button>
        </Stack>
    );
};
