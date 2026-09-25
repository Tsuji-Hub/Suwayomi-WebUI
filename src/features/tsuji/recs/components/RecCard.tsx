/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { memo, useMemo } from 'react';
import Box from '@mui/material/Box';
import ButtonBase from '@mui/material/ButtonBase';
import Chip from '@mui/material/Chip';
import Skeleton from '@mui/material/Skeleton';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import StarIcon from '@mui/icons-material/Star';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import FavoriteIcon from '@mui/icons-material/Favorite';
import { useLingui } from '@lingui/react/macro';
import { CustomTooltip } from '@/base/components/CustomTooltip.tsx';
import { RecCoverImage } from '@/features/tsuji/recs/components/RecCoverImage.tsx';
import type { OnSeenMark } from '@/features/tsuji/seen/components/SeenControls.tsx';
import { RecCardMenu, useSeenBadge } from '@/features/tsuji/seen/components/SeenControls.tsx';
import type { SeenState } from '@/features/tsuji/seen/seen.ts';
import { TypographyMaxLines } from '@/base/components/texts/TypographyMaxLines.tsx';
import { usePress } from '@/base/hooks/usePress.ts';
import { MANGA_COVER_ASPECT_RATIO } from '@/features/manga/Manga.constants.ts';
import { getScoreColor, TSUJI_MOTION, TSUJI_PALETTE } from '@/features/tsuji/Tsuji.palette.ts';
import { COMIC_TYPE_LABELS, getStatusBadge } from '@/features/tsuji/recs/Recs.constants.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import {
    abbreviateCount,
    getComicType,
    getContentTags,
    getDisplayTitle,
    htmlToPlainText,
} from '@/features/tsuji/recs/media.ts';

const MAX_TOOLTIP_SYNOPSIS = 500;

export const REC_CARD_WIDTH = 140;

const CoverBadge = styled(Typography)(({ theme }) => ({
    position: 'absolute',
    display: 'inline-flex',
    alignItems: 'center',
    gap: theme.spacing(0.25),
    paddingInline: theme.spacing(0.75),
    paddingBlock: theme.spacing(0.125),
    borderRadius: theme.shape.borderRadius,
    backgroundColor: TSUJI_PALETTE.badgeScrim,
    color: TSUJI_PALETTE.badgeText,
    fontSize: '0.75rem',
    fontWeight: 600,
    lineHeight: 1.5,
    pointerEvents: 'none',
}));

const Cover = styled('div')(({ theme }) => ({
    position: 'relative',
    width: '100%',
    aspectRatio: MANGA_COVER_ASPECT_RATIO,
    borderRadius: theme.shape.borderRadius,
    overflow: 'hidden',
    backgroundColor: theme.palette.action.hover,
}));

/** Bottom-left column: list/mark badge above the release status, so neither collides on narrow cards. */
const BottomBadges = styled('div')(({ theme }) => ({
    position: 'absolute',
    left: 6,
    bottom: 6,
    right: 6,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: theme.spacing(0.5),
    pointerEvents: 'none',
}));

const truncate = (text: string, max: number) => (text.length > max ? `${text.slice(0, max).trimEnd()}…` : text);

export type RecCardProps = {
    media: RecMedia;
    /** Recommended by both AniList and MAL. */
    agreement?: boolean;
    onOpen: (media: RecMedia) => void;
    onPreview: (media: RecMedia) => void;
    /** On the user's AniList list or manually marked. */
    seenState?: SeenState | null;
    /** Enables the overflow menu (Mark as read / Not interested / Unhide). */
    onMark?: OnSeenMark;
};

export const RecCard = memo(({ media, agreement = false, onOpen, onPreview, seenState, onMark }: RecCardProps) => {
    const { t } = useLingui();
    const seenBadge = useSeenBadge(seenState, media.chapters);

    const title = getDisplayTitle(media);
    const synopsis = useMemo(
        () => truncate(htmlToPlainText(media.description), MAX_TOOLTIP_SYNOPSIS),
        [media.description],
    );
    const status = getStatusBadge(media.status);
    const comicType = getComicType(media.countryOfOrigin);
    const tags = getContentTags(media).slice(0, 2);
    const popularity = media.popularity ?? 0;

    const bindPress = usePress({ onLongPress: () => onPreview(media), onPress: () => onOpen(media) });

    return (
        <Stack sx={{ minWidth: 0, gap: 0.5, containerType: 'inline-size' }}>
            <CustomTooltip
                title={synopsis ? <Box sx={{ whiteSpace: 'pre-line' }}>{synopsis}</Box> : ''}
                disabled={!synopsis}
                placement="right"
                enterDelay={500}
                enterNextDelay={150}
                slotProps={{ tooltip: { sx: { maxWidth: 360 } } }}
            >
                <ButtonBase
                    {...bindPress()}
                    onContextMenu={(event) => {
                        event.preventDefault();
                        onPreview(media);
                    }}
                    aria-label={title}
                    sx={{
                        display: 'block',
                        width: '100%',
                        borderRadius: 1,
                        textAlign: 'left',
                        '@media (prefers-reduced-motion: no-preference)': {
                            transition: `transform ${TSUJI_MOTION.pressMs}ms ${TSUJI_MOTION.easeOut}`,
                            '&:active': { transform: 'scale(0.97)' },
                        },
                    }}
                >
                    <Cover>
                        {media.coverImage?.large && (
                            <RecCoverImage
                                src={media.coverImage.large}
                                alt={title}
                                isLazy
                                sx={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        )}
                        {media.averageScore !== null && (
                            <CoverBadge sx={{ top: 6, left: 6 }}>
                                <StarIcon sx={{ fontSize: '0.9rem', color: getScoreColor(media.averageScore) }} />
                                {`${media.averageScore}%`}
                            </CoverBadge>
                        )}
                        {!!media.chapters && media.chapters > 0 && (
                            <CoverBadge sx={{ top: 6, right: 6 }}>
                                <MenuBookIcon sx={{ fontSize: '0.85rem' }} />
                                {media.chapters}
                            </CoverBadge>
                        )}
                        {(seenBadge || status) && (
                            <BottomBadges>
                                {seenBadge && (
                                    <CoverBadge sx={{ position: 'static' }}>
                                        <Box component="span" sx={{ color: seenBadge.color }}>
                                            ■
                                        </Box>
                                        {seenBadge.text}
                                    </CoverBadge>
                                )}
                                {status && (
                                    <CoverBadge sx={{ position: 'static' }}>
                                        <Box component="span" sx={{ color: status.color }}>
                                            ●
                                        </Box>
                                        {t(status.label)}
                                    </CoverBadge>
                                )}
                            </BottomBadges>
                        )}
                    </Cover>
                </ButtonBase>
            </CustomTooltip>
            <TypographyMaxLines variant="body2" lines={2} sx={{ fontWeight: 600 }} title={title}>
                {title}
            </TypographyMaxLines>
            <Stack direction="row" sx={{ alignItems: 'center', gap: 0.75, color: 'text.secondary' }}>
                {comicType && <Typography variant="caption">{t(COMIC_TYPE_LABELS[comicType])}</Typography>}
                {popularity > 0 && (
                    <Stack direction="row" sx={{ alignItems: 'center', gap: 0.25 }}>
                        <FavoriteIcon sx={{ fontSize: '0.8rem' }} />
                        <Typography variant="caption">{abbreviateCount(popularity)}</Typography>
                    </Stack>
                )}
                {onMark && <RecCardMenu media={media} seenState={seenState} onMark={onMark} onPreview={onPreview} />}
            </Stack>
            {!!tags.length && (
                <Stack
                    direction="row"
                    sx={{ gap: 0.5, flexWrap: 'wrap', '@container (max-width: 129px)': { display: 'none' } }}
                >
                    {tags.map(({ name }) => (
                        <Chip key={name} label={name} size="small" variant="outlined" sx={{ maxWidth: '100%' }} />
                    ))}
                </Stack>
            )}
            {agreement && (
                <Typography variant="caption" sx={{ color: 'primary.main', fontWeight: 600 }}>
                    {t`AniList + MAL`}
                </Typography>
            )}
        </Stack>
    );
});

export const RecCardSkeleton = () => (
    <Stack sx={{ minWidth: 0, gap: 0.5 }}>
        <Skeleton variant="rounded" sx={{ width: '100%', height: 'auto', aspectRatio: MANGA_COVER_ASPECT_RATIO }} />
        <Skeleton variant="text" />
        <Skeleton variant="text" sx={{ width: '60%' }} />
    </Stack>
);
