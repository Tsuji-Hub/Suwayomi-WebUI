/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

/*
 * Comment bodies are Markdown-ish text. They are only ever rendered as React text (never innerHTML): this turns the
 * few tokens Comick users rely on into structure. `||spoiler||` -> a tap-to-reveal chip, lines starting with `>` ->
 * a quote block, `[label](url)` -> its label, emphasis markers dropped. Everything else stays as typed.
 */

export type TextSegment = { type: 'text'; text: string } | { type: 'spoiler'; text: string };

export type TextBlock = { type: 'paragraph' | 'quote'; lines: TextSegment[][] };

const stripInline = (text: string) =>
    text
        .replaceAll(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
        .replaceAll(/\[([^\]]+)\]\([^)]*\)/g, '$1')
        .replaceAll(/(\*\*|__)(.+?)\1/g, '$2')
        .replaceAll(/~~(.+?)~~/g, '$1');

export const tokenizeLine = (line: string): TextSegment[] => {
    const segments: TextSegment[] = [];
    const pattern = /\|\|(.+?)\|\|/g;
    let last = 0;
    for (let match = pattern.exec(line); match; match = pattern.exec(line)) {
        if (match.index > last) {
            segments.push({ type: 'text', text: stripInline(line.slice(last, match.index)) });
        }
        segments.push({ type: 'spoiler', text: stripInline(match[1]) });
        last = match.index + match[0].length;
    }
    if (last < line.length) {
        segments.push({ type: 'text', text: stripInline(line.slice(last)) });
    }
    return segments.filter((segment) => segment.text !== '');
};

/** Consecutive `>` lines form one quote block; other lines group into paragraphs split by blank lines. */
export const parseCommentBody = (body: string): TextBlock[] => {
    const blocks: TextBlock[] = [];
    let current: TextBlock | null = null;

    body.replaceAll('\r\n', '\n')
        .split('\n')
        .forEach((rawLine) => {
            const isQuote = /^\s*>/.test(rawLine);
            const line = isQuote ? rawLine.replace(/^\s*>\s?/, '') : rawLine;
            const type = isQuote ? 'quote' : 'paragraph';

            if (!isQuote && line.trim() === '') {
                current = null;
                return;
            }
            if (!current || current.type !== type) {
                current = { type, lines: [] };
                blocks.push(current);
            }
            current.lines.push(tokenizeLine(line));
        });

    return blocks.filter((block) => block.lines.some((segments) => segments.length > 0));
};
