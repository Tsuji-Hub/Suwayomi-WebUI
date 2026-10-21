/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import ButtonBase from '@mui/material/ButtonBase';
import Collapse from '@mui/material/Collapse';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import { useAniListHealth } from '@/features/tsuji/services/useAniListHealth.ts';

/**
 * One quiet line while AniList is down and a section shows its fallback (brief #15); a click shows AniList's last
 * error and when it is asked again. Nothing while AniList is up.
 */
export const AniListFallbackNote = ({ message }: { message: string }) => {
    const { t, i18n } = useLingui();
    const health = useAniListHealth();
    const [isOpen, setIsOpen] = useState(false);
    if (!health.isDown) {
        return null;
    }
    const retryAt = new Date(health.nextProbeAt).toLocaleTimeString(i18n.locale, {
        hour: '2-digit',
        minute: '2-digit',
    });
    const lastError = health.lastError ?? t`no answer`;
    return (
        <Stack sx={{ alignItems: 'flex-start' }} role="status">
            <ButtonBase
                onClick={() => setIsOpen((open) => !open)}
                aria-expanded={isOpen}
                sx={{ borderRadius: 1, textAlign: 'left' }}
            >
                <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                    {message}
                </Typography>
            </ButtonBase>
            <Collapse in={isOpen}>
                <Typography variant="caption" sx={{ color: 'text.secondary', display: 'block' }}>
                    {t`AniList's last answer: ${lastError}. Asked again at ${retryAt}.`}
                </Typography>
            </Collapse>
        </Stack>
    );
};
