// Generates "Most Used Languages" SVG cards from every non-fork repository
// owned by the token's user, including private ones.
// Only aggregated language percentages are written to the output; no repository
// names or code leave the API response.
import { mkdir, writeFile } from "node:fs/promises";

const token = process.env.GH_STATS_TOKEN;
const langsCount = Number(process.env.LANGS_COUNT ?? 8);
const outDir = process.env.OUT_DIR ?? "generated";
const excluded = new Set(
  (process.env.EXCLUDE_LANGS ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean),
);

if (!token) {
  console.error("GH_STATS_TOKEN is not set. Add it as a repository secret.");
  process.exit(1);
}

const QUERY = `
  query ($after: String) {
    viewer {
      repositories(first: 100, after: $after, ownerAffiliations: OWNER, isFork: false) {
        pageInfo { hasNextPage endCursor }
        nodes {
          languages(first: 20, orderBy: { field: SIZE, direction: DESC }) {
            edges { size node { name color } }
          }
        }
      }
    }
  }`;

async function fetchLanguages() {
  const totals = new Map();
  let after = null;
  do {
    const res = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: {
        Authorization: `bearer ${token}`,
        "Content-Type": "application/json",
        "User-Agent": "top-langs-card",
      },
      body: JSON.stringify({ query: QUERY, variables: { after } }),
    });
    const body = await res.json();
    if (!res.ok || body.errors) {
      throw new Error(`GitHub API error: ${res.status} ${JSON.stringify(body.errors ?? body)}`);
    }
    const repos = body.data.viewer.repositories;
    for (const repo of repos.nodes) {
      for (const { size, node } of repo.languages.edges) {
        if (excluded.has(node.name.toLowerCase())) continue;
        const prev = totals.get(node.name) ?? { size: 0, color: node.color ?? "#858585" };
        prev.size += size;
        totals.set(node.name, prev);
      }
    }
    after = repos.pageInfo.hasNextPage ? repos.pageInfo.endCursor : null;
  } while (after);
  return totals;
}

const escapeXml = (s) =>
  s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

const THEMES = {
  dark: { bg: "#0D1117", title: "#70A5FD", text: "#A9B1D6", track: "#1F2937" },
  light: { bg: "#FFFEFE", title: "#2F80ED", text: "#434D58", track: "#E5E7EB" },
};

function renderCard(langs, theme) {
  const t = THEMES[theme];
  const width = 350;
  const pad = 25;
  const barWidth = width - pad * 2;
  const rows = Math.ceil(langs.length / 2);
  const height = 95 + rows * 25 + 10;

  let x = pad;
  const segments = langs
    .map((l) => {
      const w = (l.percent / 100) * barWidth;
      const seg = `<rect x="${x.toFixed(2)}" y="55" width="${w.toFixed(2)}" height="8" fill="${l.color}"/>`;
      x += w;
      return seg;
    })
    .join("");

  const legend = langs
    .map((l, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const lx = pad + col * (barWidth / 2);
      const ly = 95 + row * 25;
      return `<g transform="translate(${lx},${ly})"><circle cx="5" cy="-4" r="5" fill="${l.color}"/><text x="15" y="0" class="lang">${escapeXml(l.name)} ${l.percent.toFixed(2)}%</text></g>`;
    })
    .join("");

  const body = langs.length
    ? `<clipPath id="bar"><rect x="${pad}" y="55" width="${barWidth}" height="8" rx="4"/></clipPath><rect x="${pad}" y="55" width="${barWidth}" height="8" rx="4" fill="${t.track}"/><g clip-path="url(#bar)">${segments}</g>${legend}`
    : `<text x="${pad}" y="80" class="lang">No languages data.</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="Most Used Languages">
<style>.title{font:600 18px 'Segoe UI',Ubuntu,Sans-Serif;fill:${t.title}}.lang{font:400 11px 'Segoe UI',Ubuntu,Sans-Serif;fill:${t.text}}</style>
<rect width="100%" height="100%" rx="4.5" fill="${t.bg}"/>
<text x="${pad}" y="35" class="title">Most Used Languages</text>
${body}
</svg>
`;
}

const totals = await fetchLanguages();
const sum = [...totals.values()].reduce((a, b) => a + b.size, 0);
const top = [...totals.entries()]
  .sort((a, b) => b[1].size - a[1].size)
  .slice(0, langsCount);
const topSum = top.reduce((a, [, v]) => a + v.size, 0);
const langs = top.map(([name, v]) => ({ name, color: v.color, percent: (v.size / topSum) * 100 }));

await mkdir(outDir, { recursive: true });
for (const theme of Object.keys(THEMES)) {
  await writeFile(`${outDir}/top-langs-${theme}.svg`, renderCard(langs, theme));
}
console.log(`Languages found: ${totals.size} (total bytes: ${sum}). Wrote top ${langs.length} to ${outDir}/.`);
