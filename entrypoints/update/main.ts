import { SITE_URL } from '../../lib/api';
import {
  askAccess,
  currentVersion,
  download,
  fetchLatest,
  install,
  isOurFolder,
  isUnpacked,
  loadFolder,
  newer,
  saveFolder,
  type UpdateInfo,
} from '../../lib/updater';
import { UPDATED_KEY } from '../../lib/keys';

const $ = (id: string) => document.getElementById(id)!;
const show = (id: string, on = true) => $(id).classList.toggle('hide', !on);
const text = (id: string, s: string) => ($(id).textContent = s);

function progress(pct: number, label: string) {
  show('bar');
  ($('fill') as HTMLElement).style.width = `${pct}%`;
  text('sub', label);
}

function fail(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  ($('go') as HTMLButtonElement).disabled = false;
  if (/abort/i.test(msg)) return; // closed the folder picker
  text('err', msg);
  show('err');
}

/** The remembered folder, or ask for it (first update only). */
async function folder(): Promise<FileSystemDirectoryHandle> {
  const saved = await loadFolder();
  if (saved && (await isOurFolder(saved).catch(() => false))) {
    if (await askAccess(saved)) return saved;
    throw new Error('Smart Tasks needs permission to update its folder.');
  }
  const picker = (window as unknown as { showDirectoryPicker: (o: object) => Promise<FileSystemDirectoryHandle> }).showDirectoryPicker;
  const dir = await picker({ id: 'smart-tasks', mode: 'readwrite', startIn: 'documents' });
  if (!(await isOurFolder(dir))) {
    throw new Error('That folder is not this copy of Smart Tasks. Pick the folder you chose with "Load unpacked" (it contains manifest.json).');
  }
  if (!(await askAccess(dir))) throw new Error('Smart Tasks needs permission to update its folder.');
  await saveFolder(dir);
  return dir;
}

async function run(info: UpdateInfo) {
  const btn = $('go') as HTMLButtonElement;
  btn.disabled = true;
  show('err', false);
  try {
    const dir = await folder();
    progress(15, 'Downloading...');
    const files = await download(info);
    progress(60, 'Installing...');
    await install(dir, files);
    progress(100, 'Done. Restarting Smart Tasks...');
    await chrome.storage.local.set({ [UPDATED_KEY]: { from: currentVersion(), to: info.version } });
    setTimeout(() => chrome.runtime.reload(), 600);
  } catch (e) {
    show('bar', false);
    text('sub', `Version ${info.version} is ready.`);
    fail(e);
  }
}

async function main() {
  const now = currentVersion();
  if (!(await isUnpacked())) {
    text('title', `Smart Tasks ${now}`);
    text('sub', 'Your browser keeps this copy up to date automatically.');
    return;
  }
  let info: UpdateInfo;
  try {
    info = await fetchLatest();
  } catch (e) {
    text('title', 'Could not check for updates');
    text('sub', 'Check your connection and try again.');
    return fail(e);
  }
  if (!newer(info.version, now)) {
    $('title').innerHTML = `Smart Tasks ${now}<span class="pill">Latest</span>`;
    text('sub', 'You have the newest version.');
    $('help').innerHTML = `See what changed in the <a href="${SITE_URL}/#changelog" target="_blank" rel="noreferrer">changelog</a>.`;
    show('help');
    return;
  }

  text('title', `Version ${info.version} is ready`);
  text('sub', `You have ${now}.`);
  const ul = $('notes');
  for (const n of info.notes) {
    const li = document.createElement('li');
    li.textContent = n;
    ul.appendChild(li);
  }
  show('notes', info.notes.length > 0);
  show('go');

  const saved = await loadFolder().catch(() => undefined);
  $('help').innerHTML = saved
    ? 'Updates install into the same folder as before.'
    : 'First time only: choose the <b>Smart Tasks folder</b> you loaded in your browser, then allow editing. Pick <b>Allow on every visit</b> and future updates install on their own.';
  show('help');

  $('go').addEventListener('click', () => void run(info));
  if (new URLSearchParams(location.search).get('go') === '1' && saved) void run(info);
}

void main();
