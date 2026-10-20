/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { useEffect, useState } from 'react';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Link from '@mui/material/Link';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { useLingui } from '@lingui/react/macro';
import { aniList, ANILIST_TIMEOUT_MS } from '@/features/tsuji/services/AniListClient.ts';
import { isAniListUrl } from '@/features/tsuji/recs/media.ts';

export const REVIEWS_QUERY = `
    query TsujiReviews($id: Int) {
        Media(id: $id, type: MANGA) {
            reviews(sort: RATING_DESC, perPage: 5) {
                nodes { summary score rating ratingAmount siteUrl user { name } }
            }
        }
    }
`;

export type Review = {
    summary: string | null;
    score: number | null;
    rating: number | null;
    ratingAmount: number | null;
    siteUrl: string | null;
    user: { name: string | null } | null;
};

type ReviewsResponse = { Media: { reviews: { nodes: (Review | null)[] | null } | null } | null };

/** Reviews of this session, by AniList id (one request per title at most). */
const reviewsCache = new Map<number, Review[]>();

type ReviewsState = { status: 'loading' } | { status: 'error' } | { status: 'ready'; reviews: Review[] };

/** Reviews tab of the preview: AniList's five best-rated reviews, summary and score, linking out. */
export const PreviewReviews = ({ anilistId }: { anilistId: number }) => {
    const { t } = useLingui();
    const [state, setState] = useState<ReviewsState>(() =>
        reviewsCache.has(anilistId)
            ? { status: 'ready', reviews: reviewsCache.get(anilistId)! }
            : { status: 'loading' },
    );
    const [attempt, setAttempt] = useState(0);

    useEffect(() => {
        if (reviewsCache.has(anilistId)) {
            setState({ status: 'ready', reviews: reviewsCache.get(anilistId)! });
            return undefined;
        }
        const controller = new AbortController();
        setState({ status: 'loading' });
        aniList
            .request<ReviewsResponse>(
                REVIEWS_QUERY,
                { id: anilistId },
                { signal: controller.signal, timeoutMs: ANILIST_TIMEOUT_MS.slow },
            )
            .then((data) => {
                const reviews = (data.Media?.reviews?.nodes ?? []).filter((review): review is Review => !!review);
                reviewsCache.set(anilistId, reviews);
                if (!controller.signal.aborted) {
                    setState({ status: 'ready', reviews });
                }
            })
            .catch(() => !controller.signal.aborted && setState({ status: 'error' }));
        return () => controller.abort();
    }, [anilistId, attempt]);

    if (state.status === 'loading') {
        return (
            <CircularProgress size={24} sx={{ display: 'block', mx: 'auto', my: 4 }} aria-label={t`Loading reviews`} />
        );
    }
    if (state.status === 'error') {
        return (
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, py: 2 }}>
                <Typography variant="body2" sx={{ color: 'text.secondary' }}>
                    {t`Couldn't load reviews.`}
                </Typography>
                <Button size="small" onClick={() => setAttempt((value) => value + 1)}>
                    {t`Retry`}
                </Button>
            </Stack>
        );
    }
    if (!state.reviews.length) {
        return (
            <Typography variant="body2" sx={{ color: 'text.secondary', py: 2 }}>
                {t`No reviews on AniList yet.`}
            </Typography>
        );
    }

    return (
        <Stack sx={{ gap: 2, py: 1 }} aria-label={t`Reviews`}>
            {state.reviews.map((review, index) => (
                // oxlint-disable-next-line react/no-array-index-key
                <Stack key={index} sx={{ gap: 0.5 }}>
                    <Stack direction="row" sx={{ gap: 1, alignItems: 'baseline', flexWrap: 'wrap' }}>
                        {review.score !== null && <Typography variant="subtitle2">{`${review.score}/100`}</Typography>}
                        <Typography variant="caption" sx={{ color: 'text.secondary' }}>
                            {[
                                review.user?.name,
                                review.ratingAmount
                                    ? t`${review.rating ?? 0} of ${review.ratingAmount} found it helpful`
                                    : null,
                            ]
                                .filter(Boolean)
                                .join(' · ')}
                        </Typography>
                    </Stack>
                    <Typography variant="body2">{review.summary}</Typography>
                    {isAniListUrl(review.siteUrl) && (
                        <Link href={review.siteUrl} target="_blank" rel="noopener noreferrer" variant="caption">
                            {t`Read on AniList`}
                        </Link>
                    )}
                </Stack>
            ))}
        </Stack>
    );
};
