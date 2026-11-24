// Builds the public download page (site/public) from the production extension build.
//   1. zips dist/chrome-mv3 as smart-tasks-<version>.zip (and smart-tasks-latest.zip)
//   2. renders CHANGELOG.md into site/template.html
// Run `npm run site` (builds the extension first) and `npm run site:deploy` to publish.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { copyFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const dist = join(root, 'dist/chrome-mv3');
const out = join(root, 'site/public');
const API = 'https://smart-tasks-api.ashfadhossain0.workers.dev';
const SITE = 'https://smart-tasks.ashfadhossain0.workers.dev';

const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
const version = manifest.version;
if (readFileSync(join(dist, 'background.js'), 'utf8').includes('localhost:')) {
  throw new Error('dist/ was built against a local API. Run `npm run build` without VITE_API_URL first.');
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

// Zip the folder contents under a "smart-tasks" folder so it unzips cleanly.
const zip = `smart-tasks-${version}.zip`;
const stage = join(root, '.site-stage');
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage);
cpSync(dist, join(stage, 'smart-tasks'), { recursive: true });
try {
  execFileSync('zip', ['-qr', '-X', join(out, zip), 'smart-tasks'], { cwd: stage });
} catch (e) {
  // Windows has no zip command; its built-in bsdtar writes zips too.
  if (e.code !== 'ENOENT' || process.platform !== 'win32') throw e;
  const tar = join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'tar.exe');
  execFileSync(tar, ['-a', '-c', '-f', join(out, zip), 'smart-tasks'], { cwd: stage });
}
rmSync(stage, { recursive: true, force: true });
copyFileSync(join(out, zip), join(out, 'smart-tasks-latest.zip'));
const kb = Math.round(statSync(join(out, zip)).size / 1024);
const size = kb >= 1024 ? `${(kb / 1024).toFixed(1)} MB` : `${kb} KB`;

copyFileSync(join(root, 'public/icon/128.png'), join(out, 'icon-128.png'));

/* ── changelog markdown → HTML (just the subset CHANGELOG.md uses) ───────── */
const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/`(.+?)`/g, '<code>$1</code>');
const chev = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

const releases = [];
for (const line of readFileSync(join(root, 'CHANGELOG.md'), 'utf8').split(/\r?\n/)) {
  const rel = /^## (\S+)\s*-\s*(.+)$/.exec(line);
  const grp = /^### (.+)$/.exec(line);
  const item = /^- (.+)$/.exec(line);
  if (rel) releases.push({ version: rel[1], date: rel[2].trim(), groups: [] });
  else if (grp && releases.length) releases.at(-1).groups.push({ name: grp[1].trim(), items: [] });
  else if (item && releases.at(-1)?.groups.length) releases.at(-1).groups.at(-1).items.push(item[1]);
}
if (!releases.length) throw new Error('CHANGELOG.md has no releases');
if (releases[0].version !== version) {
  throw new Error(`CHANGELOG.md tops out at ${releases[0].version} but the extension is ${version}. Add release notes first.`);
}

const fmtDate = d => {
  const t = new Date(`${d}T12:00:00Z`);
  return Number.isNaN(+t) ? d : t.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
};
const changelog = releases
  .map(
    (r, i) => `<details class="release"${i === 0 ? ' open' : ''} id="v${r.version}">
  <summary><span class="ver">${esc(r.version)}</span>${i === 0 ? '<span class="latest">Latest</span>' : ''}<span class="date">${esc(fmtDate(r.date))}</span>${chev}</summary>
  <div class="body">${r.groups
    .map(g => `<div class="group"><span class="tag ${esc(g.name.toLowerCase())}">${esc(g.name)}</span><ul>${g.items.map(x => `<li>${inline(x)}</li>`).join('')}</ul></div>`)
    .join('')}</div>
</details>`,
  )
  .join('\n');

/* ── logo (same artwork as the extension icon) ───────────────────────────── */
const logo = id => `<svg viewBox="16 16 480 480" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
<defs><linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#6ff0dc"/><stop offset=".5" stop-color="#3fd1c5"/><stop offset="1" stop-color="#2794bd"/></linearGradient>
<linearGradient id="${id}s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/></linearGradient></defs>
<rect x="16" y="16" width="480" height="480" rx="124" fill="url(#${id}b)"/><rect x="16" y="16" width="480" height="480" rx="124" fill="url(#${id}s)"/>
<rect x="100" y="120" width="140" height="36" rx="18" fill="#0b1a1c" opacity=".22"/><rect x="100" y="190" width="88" height="36" rx="18" fill="#0b1a1c" opacity=".22"/>
<path d="M164 318 L234 386 L404 214" fill="none" stroke="#0b1a1c" stroke-width="62" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M392 64 C396 92 404 100 432 104 C404 108 396 116 392 144 C388 116 380 108 352 104 C380 100 388 92 392 64 Z" fill="#fff"/>
<circle cx="446" cy="160" r="11" fill="#fff" opacity=".85"/></svg>`;

/* ── Desktop app (desktop/): Windows + macOS downloads and the updater's latest.json ── */
// Built by `npm run desktop:build`; Cargo's target dir is moved off paths with
// spaces by desktop/scripts/tauri.mjs, so look there too.
const targetDirs = [
  process.env.CARGO_TARGET_DIR,
  process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, 'smart-tasks-build', 'target'),
  join(root, 'desktop/src-tauri/target'),
].filter(Boolean);
const deskOut = join(out, 'desktop');
const platforms = {};
// What the page offers: href + size per platform, or null when not built yet.
const dl = { win: null, mac: null, ext: { href: `/${zip}`, size } };
const mbOf = p => (statSync(p).size / 1024 / 1024).toFixed(1);
const signature = p => readFileSync(`${p}.sig`, 'utf8').trim();

const setupName = `Smart Tasks_${version}_x64-setup.exe`;
// Built on this PC (Cargo target dir), or on GitHub by .github/workflows/desktop-windows.yml
// and fetched into desktop/release/windows with `npm run desktop:win:fetch`.
const setupSrc = [...targetDirs.map(d => join(d, 'release/bundle/nsis', setupName)), join(root, 'desktop/release/windows', setupName)].find(
  p => existsSync(p) && existsSync(`${p}.sig`),
);
if (setupSrc) {
  const exe = `smart-tasks-setup-${version}.exe`;
  mkdirSync(deskOut, { recursive: true });
  copyFileSync(setupSrc, join(deskOut, exe));
  copyFileSync(setupSrc, join(deskOut, 'smart-tasks-setup-latest.exe'));
  platforms['windows-x86_64'] = { signature: signature(setupSrc), url: `${SITE}/desktop/${exe}` };
  dl.win = { href: `/desktop/${exe}`, size: `${mbOf(setupSrc)} MB` };
} else {
  console.warn(`No signed Windows installer for ${version} (run \`npm run desktop:build\`).`);
}

// macOS: one universal build (Apple silicon + Intel) made on GitHub by
// .github/workflows/desktop-macos.yml and fetched into desktop/release/macos
// with `npm run desktop:mac:fetch`. The .dmg is the download; the
// .app.tar.gz (+ .sig) is what the updater installs.
const macDir = join(root, 'desktop/release/macos');
const macFiles = existsSync(macDir) ? readdirSync(macDir) : [];
const dmgName = macFiles.find(n => n.endsWith(`_${version}_universal.dmg`));
const tarName = macFiles.find(n => n.endsWith('.app.tar.gz') && macFiles.includes(`${n}.sig`));
if (dmgName && tarName) {
  const dmg = `smart-tasks-${version}-mac.dmg`;
  const tar = `smart-tasks-${version}-mac.app.tar.gz`;
  mkdirSync(deskOut, { recursive: true });
  copyFileSync(join(macDir, dmgName), join(deskOut, dmg));
  copyFileSync(join(macDir, dmgName), join(deskOut, 'smart-tasks-mac-latest.dmg'));
  copyFileSync(join(macDir, tarName), join(deskOut, tar));
  const mac = { signature: signature(join(macDir, tarName)), url: `${SITE}/desktop/${tar}` };
  platforms['darwin-aarch64'] = mac;
  platforms['darwin-x86_64'] = mac;
  dl.mac = { href: `/desktop/${dmg}`, size: `${mbOf(join(macDir, dmgName))} MB` };
} else {
  console.warn(`No macOS ${version} build in desktop/release/macos (run \`npm run desktop:mac:fetch\` after the GitHub build).`);
}

// No desktop build on this machine (the extension can be released on its own):
// keep the desktop app that is already published, so its downloads and the
// desktop updater's latest.json don't disappear with this deploy.
let keptDesktop = null;
if (!Object.keys(platforms).length) {
  const res = await fetch(`${SITE}/desktop/latest.json`, { cache: 'no-store' }).catch(() => null);
  if (res?.ok) {
    keptDesktop = await res.json();
    const v = keptDesktop.version;
    const grab = async (name, ...aliases) => {
      const r = await fetch(`${SITE}/desktop/${name}`);
      if (!r.ok) return null;
      mkdirSync(deskOut, { recursive: true });
      const buf = Buffer.from(await r.arrayBuffer());
      for (const n of [name, ...aliases]) writeFileSync(join(deskOut, n), buf);
      return { href: `/desktop/${name}`, size: `${(buf.length / 1024 / 1024).toFixed(1)} MB` };
    };
    if (keptDesktop.platforms['windows-x86_64']) dl.win = await grab(`smart-tasks-setup-${v}.exe`, 'smart-tasks-setup-latest.exe');
    if (keptDesktop.platforms['darwin-aarch64']) {
      dl.mac = await grab(`smart-tasks-${v}-mac.dmg`, 'smart-tasks-mac-latest.dmg');
      await grab(`smart-tasks-${v}-mac.app.tar.gz`);
    }
    writeFileSync(join(deskOut, 'latest.json'), JSON.stringify(keptDesktop, null, 2));
    console.warn(`Keeping the published desktop app ${v} (no desktop build for ${version} here).`);
  }
}

// A Windows-only release: keep offering the Mac download that is already published.
// It stays out of this version's latest.json, so Mac apps just stay on their version
// (listing the older build there would make them "update" to it again and again).
if (Object.keys(platforms).length && !dl.mac) {
  // Read the Mac link off the live download page: latest.json leaves Mac out
  // after a Windows-only release, so it can't tell us on the next one.
  const page = await fetch(`${SITE}/`, { cache: 'no-store' })
    .then(r => (r.ok ? r.text() : ''))
    .catch(() => '');
  const v = page.match(/\/desktop\/smart-tasks-([\d.]+)-mac\.dmg/)?.[1];
  const r = v && (await fetch(`${SITE}/desktop/smart-tasks-${v}-mac.dmg`).catch(() => null));
  if (r?.ok) {
    const buf = Buffer.from(await r.arrayBuffer());
    for (const n of [`smart-tasks-${v}-mac.dmg`, 'smart-tasks-mac-latest.dmg']) writeFileSync(join(deskOut, n), buf);
    dl.mac = { href: `/desktop/smart-tasks-${v}-mac.dmg`, size: `${(buf.length / 1024 / 1024).toFixed(1)} MB` };
    console.warn(`Keeping the published Mac app ${v} on the download page (no macOS ${version} build here).`);
  }
}

// The updater's manifest lists whichever platforms are present.
if (Object.keys(platforms).length) {
  writeFileSync(
    join(deskOut, 'latest.json'),
    JSON.stringify(
      {
        version,
        notes: releases[0].groups.flatMap(g => g.items.map(i => `- ${i.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1')}`)).join('\n'),
        pub_date: new Date(`${releases[0].date}T12:00:00Z`).toISOString(),
        platforms,
      },
      null,
      2,
    ),
  );
}
/* ── download cards (one per platform; missing builds show as "coming soon") ── */
const PLAT = {
  win: { name: 'Windows', sub: 'Windows 10 and 11, 64-bit', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M3 5.5 10.5 4.5v7H3zM11.5 4.4 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.4z"/></svg>' },
  mac: { name: 'macOS', sub: 'Apple silicon and Intel, macOS 13+', icon: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M16.4 12.6c0-2.4 2-3.6 2.1-3.7-1.2-1.7-3-1.9-3.6-2-1.5-.2-3 .9-3.8.9-.8 0-2-.9-3.3-.9-1.7 0-3.3 1-4.2 2.6-1.8 3.1-.5 7.7 1.3 10.2.9 1.2 1.9 2.6 3.2 2.6 1.3-.1 1.8-.8 3.3-.8 1.6 0 2 .8 3.4.8 1.4 0 2.3-1.3 3.1-2.5 1-1.4 1.4-2.8 1.4-2.9 0 0-2.8-1.1-2.9-4.3zM13.9 5.3c.7-.9 1.2-2 1-3.3-1 0-2.2.7-3 1.5-.6.7-1.2 1.9-1 3.1 1.1.1 2.3-.6 3-1.3z"/></svg>' },
  ext: { name: 'Browser extension', sub: 'Chrome, Comet, Brave, Edge, Arc', icon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="3.5"/><path d="M12 8.5h8.5M8.97 13.75 4.7 6.4M15.03 13.75 10.8 21"/></svg>' },
};
const dlCards = ['win', 'mac', 'ext']
  .map(k => {
    const p = PLAT[k];
    const d = dl[k];
    const head = `<span class="dl-ico">${p.icon}</span><span class="dl-txt"><b>${p.name}</b><small>${p.sub}</small></span>`;
    return d
      ? `<a class="dl-card reveal" data-plat="${k}" href="${d.href}" download>${head}<span class="dl-go"><span>${d.size}</span><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M6.5 10.5 12 16l5.5-5.5M5 20h14"/></svg></span></a>`
      : `<div class="dl-card soon reveal" data-plat="${k}">${head}<span class="dl-go"><span>Coming soon</span></span></div>`;
  })
  .join('\n');
const dlJson = JSON.stringify(Object.fromEntries(Object.entries(dl).map(([k, v]) => [k, v && { ...v, name: PLAT[k].name }])));

const html = readFileSync(join(root, 'site/template.html'), 'utf8')
  .replaceAll('{{DL_CARDS}}', dlCards)
  .replaceAll('{{DL_JSON}}', dlJson.replace(/</g, '\\u003c'))
  .replaceAll('{{VERSION}}', esc(version))
  .replaceAll('{{SIZE}}', size)
  .replaceAll('{{ZIP}}', zip)
  .replaceAll('{{DATE}}', esc(fmtDate(releases[0].date)))
  .replaceAll('{{API}}', API)
  .replaceAll('{{LOGO}}', logo('n'))
  .replaceAll('{{LOGO_BIG}}', logo('h'))
  .replaceAll('{{CHANGELOG}}', changelog);
writeFileSync(join(out, 'index.html'), html);
copyFileSync(join(root, 'CHANGELOG.md'), join(out, 'CHANGELOG.md'));

// What the extension's updater reads to find and verify a new version.
const plain = s => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`(.+?)`/g, '$1');
writeFileSync(
  join(out, 'version.json'),
  JSON.stringify(
    {
      version,
      date: releases[0].date,
      zip: `/${zip}`,
      size: statSync(join(out, zip)).size,
      sha256: createHash('sha256').update(readFileSync(join(out, zip))).digest('hex'),
      notes: releases[0].groups.flatMap(g => g.items.map(plain)),
    },
    null,
    2,
  ),
);

// Zips should download, the page and version info should always be fresh, and
// the extension (a chrome-extension:// origin) may fetch the update files.
writeFileSync(
  join(out, '_headers'),
  [
    '/*.zip',
    '  Content-Type: application/zip',
    '  Cache-Control: public, max-age=300',
    '  Access-Control-Allow-Origin: *',
    '/version.json',
    '  Cache-Control: no-cache',
    '  Access-Control-Allow-Origin: *',
    '/desktop/latest.json',
    '  Cache-Control: no-cache',
    '/desktop/*.exe',
    '  Content-Type: application/vnd.microsoft.portable-executable',
    '  Cache-Control: public, max-age=300',
    '/desktop/*.dmg',
    '  Content-Type: application/x-apple-diskimage',
    '  Cache-Control: public, max-age=300',
    '/desktop/*.tar.gz',
    '  Content-Type: application/gzip',
    '  Cache-Control: public, max-age=300',
    '/',
    '  Cache-Control: no-cache',
    '/index.html',
    '  Cache-Control: no-cache',
    '',
  ].join('\n'),
);

console.log(`site/public ready: ${zip} (${size}), ${releases.length} releases in the changelog`);
if (!existsSync(join(out, 'index.html'))) process.exit(1);
