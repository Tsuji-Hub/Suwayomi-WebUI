/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useState } from 'react';
import Box from '@mui/material/Box';
import type { SxProps, Theme } from '@mui/material/styles';

const CORS_HOSTS = /(^|\.)(anilist\.co|anili\.st)$/;

/** Only AniList's CDN answers CORS requests for images; other hosts (MangaBaka covers) would fail one and log an error. */
export const isCorsCoverHost = (src: string) => {
    try {
        return CORS_HOSTS.test(new URL(src).hostname);
    } catch {
        return false;
    }
};

/**
 * AniList cover. Loaded in CORS mode (the CDN reflects the origin) so upstream's service-worker image cache stores a
 * real response rather than an opaque one (Chrome bills each opaque entry ~7 MB of quota). If the CORS load fails,
 * e.g. the browser cached the URL earlier without CORS headers, it retries once in plain mode. Covers from other
 * hosts load in plain mode from the start.
 */
export const RecCoverImage = ({
    src,
    alt,
    isLazy = false,
    sx,
}: {
    src: string;
    alt: string;
    isLazy?: boolean;
    sx?: SxProps<Theme>;
}) => {
    const [corsFailedSrc, setCorsFailedSrc] = useState<string | null>(null);
    const isCorsMode = isCorsCoverHost(src) && corsFailedSrc !== src;

    return (
        <Box
            component="img"
            src={src}
            alt={alt}
            loading={isLazy ? 'lazy' : undefined}
            referrerPolicy="no-referrer"
            crossOrigin={isCorsMode ? 'anonymous' : undefined}
            onError={isCorsMode ? () => setCorsFailedSrc(src) : undefined}
            draggable={false}
            sx={sx}
        />
    );
};
