/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { loadable } from 'react-lazily/loadable';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Stack from '@mui/material/Stack';
import Tab from '@mui/material/Tab';
import Tabs from '@mui/material/Tabs';
import Typography from '@mui/material/Typography';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import SearchIcon from '@mui/icons-material/Search';
import { useLingui } from '@lingui/react/macro';
import { MANGA_COVER_ASPECT_RATIO } from '@/features/manga/Manga.constants.ts';
import { RecCoverImage } from '@/features/tsuji/recs/components/RecCoverImage.tsx';
import type { OnSeenMark } from '@/features/tsuji/seen/components/SeenControls.tsx';
import { useSeenBadge } from '@/features/tsuji/seen/components/SeenControls.tsx';
import type { SeenState } from '@/features/tsuji/seen/seen.ts';
import { COMIC_TYPE_LABELS, getStatusBadge } from '@/features/tsuji/recs/Recs.constants.ts';
import type { RecMedia } from '@/features/tsuji/recs/Recs.types.ts';
import {
    getComicType,
    getDisplayTitle,
    getVisibleTags,
    htmlToPlainText,
    isAniListUrl,
} from '@/features/tsuji/recs/media.ts';
import { isUnmatchedMedia } from '@/features/tsuji/tags/muSearch.ts';

// Comments and reviews load with their tab (code and requests): opening a preview costs nothing extra.
const { PreviewComments } = loadable(() => import('@/features/tsuji/recs/preview/PreviewComments.tsx'));
const { PreviewReviews } = loadable(() => import('@/features/tsuji/recs/preview/PreviewReviews.tsx'));

type PreviewTab = 'overview' | 'comments' | 'reviews';

/** Keeps the last media while the dialog animates out. */
export const useRecPreview = () => {
    const [media, setMedia] = useState<RecMedia | null>(null);
    const [isOpen, setIsOpen] = useState(false);

    const show = useCallback((next: RecMedia) => {
        setMedia(next);
        setIsOpen(true);
    }, []);
    const close = useCallback(() => setIsOpen(false), []);

    return { media, isOpen, show, close };
};

export const RecPreviewDialog = ({
    media,
    isOpen,
    onClose,
    onFind,
    getSeenState,
    onMark,
}: {
    media: RecMedia | null;
    isOpen: boolean;
    onClose: () => void;
    onFind: (media: RecMedia) => void;
    /** Live list/mark state, so the dialog follows a mark made from it. */
    getSeenState?: (mediaId: number) => SeenState | null;
    onMark?: OnSeenMark;
}) => {
    const { t } = useLingui();
    const synopsis = useMemo(() => htmlToPlainText(media?.description), [media?.description]);
    const seenState = media && getSeenState ? getSeenState(media.id) : null;
    const seenBadge = useSeenBadge(seenState, media?.chapters ?? null);
    const [tab, setTab] = useState<PreviewTab>('overview');

    useEffect(() => setTab('overview'), [media?.id]);

    if (!media) {
        return null;
    }

    const title = getDisplayTitle(media);
    const status = getStatusBadge(media.status);
    const comicType = getComicType(media.countryOfOrigin);
    const facts = [
        seenBadge?.text ?? null,
        comicType ? t(COMIC_TYPE_LABELS[comicType]) : null,
        status ? t(status.label) : null,
        media.chapters ? t`${media.chapters} chapters` : null,
        media.averageScore !== null ? `${media.averageScore}%` : null,
    ].filter(Boolean);

    return (
        <Dialog open={isOpen} onClose={onClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ pb: 0 }}>{title}</DialogTitle>
            <Tabs value={tab} onChange={(_, value: PreviewTab) => setTab(value)} sx={{ px: 2 }}>
                <Tab value="overview" label={t`Overview`} />
                <Tab value="comments" label={t`Comments`} />
                {!isUnmatchedMedia(media) && <Tab value="reviews" label={t`Reviews`} />}
            </Tabs>
            <DialogContent>
                {tab === 'comments' && <PreviewComments media={media} />}
                {tab === 'reviews' && <PreviewReviews anilistId={media.id} />}
                {tab === 'overview' && (
                    <>
                        <Stack direction="row" sx={{ gap: 2, alignItems: 'flex-start' }}>
                            {media.coverImage?.large && (
                                <RecCoverImage
                                    src={media.coverImage.large}
                                    alt={title}
                                    sx={{
                                        width: 120,
                                        flexShrink: 0,
                                        aspectRatio: MANGA_COVER_ASPECT_RATIO,
                                        objectFit: 'cover',
                                        borderRadius: 1,
                                    }}
                                />
                            )}
                            <Stack sx={{ gap: 1, minWidth: 0 }}>
                                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                                    {facts.join(' · ')}
                                </Typography>
                                <Typography
                                    variant="body2"
                                    sx={{ whiteSpace: 'pre-line', maxHeight: 240, overflowY: 'auto' }}
                                >
                                    {synopsis || t`No synopsis available.`}
                                </Typography>
                            </Stack>
                        </Stack>
                        <Stack direction="row" sx={{ gap: 0.5, flexWrap: 'wrap', mt: 2 }}>
                            {getVisibleTags(media).map(({ name }) => (
                                <Chip key={name} label={name} size="small" variant="outlined" />
                            ))}
                        </Stack>
                    </>
                )}
            </DialogContent>
            <DialogActions sx={{ flexWrap: 'wrap', gap: 1 }}>
                {onMark && !isUnmatchedMedia(media) && seenState?.source === 'mark' && (
                    <Button sx={{ mr: 'auto' }} onClick={() => onMark(media, null)}>
                        {t`Unhide`}
                    </Button>
                )}
                {onMark && !isUnmatchedMedia(media) && seenState?.source !== 'mark' && (
                    <Stack direction="row" sx={{ mr: 'auto', gap: 1 }}>
                        <Button onClick={() => onMark(media, 'read')}>{t`Mark as read`}</Button>
                        <Button onClick={() => onMark(media, 'skip')}>{t`Not interested`}</Button>
                    </Stack>
                )}
                {isAniListUrl(media.siteUrl) && (
                    <Button
                        component="a"
                        href={media.siteUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        startIcon={<OpenInNewIcon />}
                    >
                        {t`Open on AniList`}
                    </Button>
                )}
                <Button variant="contained" startIcon={<SearchIcon />} onClick={() => onFind(media)}>
                    {t`Find to read`}
                </Button>
            </DialogActions>
        </Dialog>
    );
};
