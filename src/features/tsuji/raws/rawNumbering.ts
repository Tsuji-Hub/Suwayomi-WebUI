/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

import type { Origin } from '@/features/tsuji/raws/rawLinks.ts';

/*
 * Raw chapter numbers come from the chapter names (the source's chapterNumber is often wrong for raws), as the
 * server's rawfinder reads them: CN the LAST "第N话", KR the FIRST "N화", JP "第N話" / "N話"; otherwise
 * chapterNumber; nothing for unnumbered entries (extras). Paywalled previews (names with 🔒) never map.
 */

const NUMBER = String.raw`(\d+(?:\.\d+)?)`;
const PATTERNS: Record<Origin, { regex: RegExp; pick: 'first' | 'last' }> = {
    CN: { regex: new RegExp(String.raw`第\s*${NUMBER}\s*[话話]`, 'g'), pick: 'last' },
    KR: { regex: new RegExp(String.raw`${NUMBER}\s*화`, 'g'), pick: 'first' },
    JP: { regex: new RegExp(String.raw`(?:第\s*)?${NUMBER}\s*話`, 'g'), pick: 'first' },
};
const ORDER_WITHOUT_ORIGIN: Origin[] = ['KR', 'CN', 'JP'];

/** Full-width digits and dot (０-９, ．) as ASCII. */
const toAsciiDigits = (text: string) =>
    text.replaceAll(/[０-９．]/g, (char) => (char === '．' ? '.' : String.fromCharCode(char.charCodeAt(0) - 0xfee0)));

export const isPaywalled = (name: string) => name.includes('🔒');

const matchOrigin = (name: string, origin: Origin): number | null => {
    const { regex, pick } = PATTERNS[origin];
    const matches = [...name.matchAll(regex)];
    const match = pick === 'first' ? matches[0] : matches.at(-1);
    return match ? Number(match[1]) : null;
};

/** The chapter number of a raw chapter, or null (extra / paywalled). */
export const parseRawChapterNumber = (
    { name, chapterNumber }: { name: string; chapterNumber: number },
    origin: Origin | null,
): number | null => {
    if (isPaywalled(name)) {
        return null;
    }
    const text = toAsciiDigits(name);
    const origins = origin ? [origin] : ORDER_WITHOUT_ORIGIN;
    for (const each of origins) {
        const number = matchOrigin(text, each);
        if (number !== null) {
            return number;
        }
    }
    return Number.isFinite(chapterNumber) && chapterNumber >= 0 ? chapterNumber : null;
};

/** Raw chapters by parsed number; the first by source order wins when two share a number. */
export const buildRawChapterMap = <T extends { name: string; chapterNumber: number; sourceOrder: number }>(
    chapters: T[],
    origin: Origin | null,
): Map<number, T> => {
    const map = new Map<number, T>();
    [...chapters]
        .sort((a, b) => a.sourceOrder - b.sourceOrder)
        .forEach((chapter) => {
            const number = parseRawChapterNumber(chapter, origin);
            if (number !== null && !map.has(number)) {
                map.set(number, chapter);
            }
        });
    return map;
};
