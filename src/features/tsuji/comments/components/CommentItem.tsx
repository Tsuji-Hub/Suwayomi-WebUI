/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import { Fragment, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Stack from '@mui/material/Stack';
import Typography from '@mui/material/Typography';
import { styled } from '@mui/material/styles';
import ThumbUpOutlinedIcon from '@mui/icons-material/ThumbUpOutlined';
import { plural } from '@lingui/core/macro';
import { useLingui } from '@lingui/react/macro';
import dayjs from 'dayjs';
import type { Comment } from '@/features/tsuji/comments/CommentSource.ts';
import type { TextSegment } from '@/features/tsuji/comments/commentText.ts';
import { parseCommentBody } from '@/features/tsuji/comments/commentText.ts';

const Spoiler = styled('button')(({ theme }) => ({
    font: 'inherit',
    color: 'inherit',
    border: 0,
    margin: 0,
    padding: theme.spacing(0, 0.5),
    borderRadius: theme.shape.borderRadius,
    cursor: 'pointer',
    textAlign: 'inherit',
    backgroundColor: theme.palette.action.selected,
    '&[aria-pressed="false"]': {
        color: 'transparent',
        backgroundColor: theme.palette.text.primary,
        userSelect: 'none',
    },
}));

const Quote = styled('blockquote')(({ theme }) => ({
    margin: 0,
    paddingLeft: theme.spacing(1.5),
    borderLeft: `3px solid ${theme.palette.divider}`,
    color: theme.palette.text.secondary,
}));

const SpoilerChip = ({ text }: { text: string }) => {
    const { t } = useLingui();
    const [isShown, setIsShown] = useState(false);

    return (
        <Spoiler
            type="button"
            aria-pressed={isShown}
            aria-label={isShown ? undefined : t`Spoiler, tap to reveal`}
            onClick={() => setIsShown((shown) => !shown)}
        >
            {text}
        </Spoiler>
    );
};

const Line = ({ segments }: { segments: TextSegment[] }) => (
    <>
        {segments.map((segment, index) =>
            segment.type === 'spoiler' ? (
                // oxlint-disable-next-line react/no-array-index-key
                <SpoilerChip key={index} text={segment.text} />
            ) : (
                // oxlint-disable-next-line react/no-array-index-key
                <Fragment key={index}>{segment.text}</Fragment>
            ),
        )}
    </>
);

/** The body as plain React text: paragraphs, quote blocks and spoiler chips, never HTML. */
const CommentBody = ({ body }: { body: string }) => {
    const blocks = useMemo(() => parseCommentBody(body), [body]);

    return (
        <Stack sx={{ gap: 0.75, overflowWrap: 'anywhere' }}>
            {blocks.map((block, blockIndex) => {
                const lines = block.lines.map((segments, lineIndex) => (
                    // oxlint-disable-next-line react/no-array-index-key
                    <Fragment key={lineIndex}>
                        {lineIndex > 0 && <br />}
                        <Line segments={segments} />
                    </Fragment>
                ));
                return block.type === 'quote' ? (
                    // oxlint-disable-next-line react/no-array-index-key
                    <Quote key={blockIndex}>
                        <Typography variant="body2" component="p" sx={{ m: 0 }}>
                            {lines}
                        </Typography>
                    </Quote>
                ) : (
                    // oxlint-disable-next-line react/no-array-index-key
                    <Typography key={blockIndex} variant="body2" component="p" sx={{ m: 0 }}>
                        {lines}
                    </Typography>
                );
            })}
        </Stack>
    );
};

const formatRelative = (createdAt: string | null) => {
    if (!createdAt) {
        return null;
    }
    const date = dayjs(createdAt);
    return date.isValid() ? date.fromNow() : null;
};

/** One comment: author, relative time, body, up count, and its replies collapsed behind "N replies". */
export const CommentItem = ({ comment, isReply = false }: { comment: Comment; isReply?: boolean }) => {
    const { t } = useLingui();
    const [isExpanded, setIsExpanded] = useState(false);
    const time = formatRelative(comment.createdAt);
    const replyCount = comment.replies.length;

    return (
        <Stack component="article" sx={{ gap: 0.5 }} aria-label={t`Comment by ${comment.author}`}>
            <Stack direction="row" sx={{ alignItems: 'baseline', gap: 1, minWidth: 0 }}>
                <Typography variant="subtitle2" noWrap sx={{ minWidth: 0 }}>
                    {comment.author}
                </Typography>
                {time && (
                    <Typography
                        variant="caption"
                        component="time"
                        dateTime={comment.createdAt ?? undefined}
                        sx={{ color: 'text.secondary', flexShrink: 0 }}
                    >
                        {time}
                    </Typography>
                )}
            </Stack>
            <CommentBody body={comment.body} />
            <Stack direction="row" sx={{ alignItems: 'center', gap: 1, minHeight: 28 }}>
                <Stack
                    direction="row"
                    sx={{ alignItems: 'center', gap: 0.5, color: 'text.secondary' }}
                    aria-label={plural(comment.upCount, { one: '# upvote', other: '# upvotes' })}
                >
                    <ThumbUpOutlinedIcon sx={{ fontSize: 14 }} />
                    <Typography variant="caption">{comment.upCount}</Typography>
                </Stack>
                {!isReply && replyCount > 0 && (
                    <Button
                        size="small"
                        onClick={() => setIsExpanded((expanded) => !expanded)}
                        aria-expanded={isExpanded}
                        sx={{ minWidth: 0, py: 0 }}
                    >
                        {isExpanded ? t`Hide replies` : plural(replyCount, { one: '# reply', other: '# replies' })}
                    </Button>
                )}
            </Stack>
            {isExpanded && (
                <Box sx={{ pl: 2, borderLeft: 1, borderColor: 'divider' }}>
                    <Stack sx={{ gap: 1.5 }}>
                        {comment.replies.map((reply) => (
                            <CommentItem key={reply.id} comment={reply} isReply />
                        ))}
                    </Stack>
                </Box>
            )}
        </Stack>
    );
};
