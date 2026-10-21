/*
 * Copyright (C) Contributors to the Suwayomi project
 *
 * This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at https://mozilla.org/MPL/2.0/.
 */

// Writes the static tag baseline For You falls back to when the week's candidate pool is under 200 titles
// (brief #14): how many of AniList's 500 most popular KR / CN manga carry each content tag (no spoiler or
// Technical tags), as src/features/tsuji/forYou/tagBaseline.json. 20 AniList requests, 2.5 s apart.
//
// Usage: node tools/scripts/tsuji/build-tag-baseline.mjs   (then commit the JSON)

import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

const OUT = resolve(process.env.OUT ?? 'src/features/tsuji/forYou/tagBaseline.json');
const TITLES = 500;
const PER_PAGE = 50;
const SPACING_MS = 2500;

const QUERY = `
    query TsujiTagBaseline($page: Int, $country: CountryCode) {
        Page(page: $page, perPage: ${PER_PAGE}) {
            media(type: MANGA, countryOfOrigin: $country, sort: POPULARITY_DESC, isAdult: false) {
                id popularity
                tags { name category isMediaSpoiler isGeneralSpoiler }
            }
        }
    }
`;

const sleep = (ms) =>
    new Promise((done) => {
        setTimeout(done, ms);
    });

const fetchPage = async (country, page, attempt = 0) => {
    const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: QUERY, variables: { page, country } }),
    });
    if (response.status === 429 && attempt < 3) {
        const retryAfter = Number(response.headers.get('retry-after')) || 60;
        console.log(`429, waiting ${retryAfter} s`);
        await sleep(retryAfter * 1000);
        return fetchPage(country, page, attempt + 1);
    }
    if (!response.ok) {
        throw new Error(`AniList answered ${response.status} for ${country} page ${page}`);
    }
    const json = await response.json();
    return json.data?.Page?.media ?? [];
};

const media = [];
for (const country of ['KR', 'CN']) {
    for (let page = 1; page <= TITLES / PER_PAGE; page += 1) {
        // One request at a time: AniList allows 30 a minute.
        // oxlint-disable-next-line no-await-in-loop
        media.push(...(await fetchPage(country, page)));
        console.log(`${country} page ${page}: ${media.length} titles so far`);
        // oxlint-disable-next-line no-await-in-loop
        await sleep(SPACING_MS);
    }
}

const top = [...new Map(media.map((item) => [item.id, item])).values()]
    .sort((a, b) => (b.popularity ?? 0) - (a.popularity ?? 0))
    .slice(0, TITLES);
const counts = {};
top.forEach(({ tags }) =>
    new Set(
        (tags ?? [])
            .filter((tag) => !tag.isMediaSpoiler && !tag.isGeneralSpoiler && tag.category !== 'Technical')
            .map(({ name }) => name),
    ).forEach((name) => {
        counts[name] = (counts[name] ?? 0) + 1;
    }),
);
const sorted = Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));

writeFileSync(
    OUT,
    `${JSON.stringify(
        {
            source: 'AniList: the 500 most popular KR / CN manga (tools/scripts/tsuji/build-tag-baseline.mjs)',
            generatedAt: new Date().toISOString().slice(0, 10),
            titles: top.length,
            counts: sorted,
        },
        null,
        4,
    )}\n`,
);
console.log(`wrote ${OUT}: ${top.length} titles, ${Object.keys(sorted).length} tags`);
