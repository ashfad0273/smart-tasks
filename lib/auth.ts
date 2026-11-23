import { api, type AuthResult } from './api';
import { storageSet } from './ext';
import { ONBOARDED_KEY } from './keys';
import { defaultCategoryOps, loadRegistry, mutate, newId, purgeLocal, readView, saveRegistry, sync, welcomeTaskOps } from './store';
import type { AccountInfo, SyncOp } from './types';
import { hueFromString } from './utils';

/**
 * Store a successful sign-in: add/refresh the account in the registry, make it
 * active, and seed a brand-new account (starter categories, or the tasks of
 * the local-only account the user was on). Shared by the popup and the
 * background worker so Google sign-in can finish even after the popup closes.
 */
export async function completeSignIn(res: AuthResult): Promise<{ account: AccountInfo; importedLocal: boolean }> {
  const reg = await loadRegistry();
  const prevActive = reg.accounts.find(a => a.uid === reg.activeId);
  const account: AccountInfo = {
    uid: res.user.uid,
    email: res.user.email,
    name: res.user.name,
    photoURL: res.user.photoURL ?? null,
    hue: hueFromString(res.user.email),
    token: res.token,
    local: false,
  };
  let accounts = reg.accounts.filter(a => a.uid !== account.uid);
  accounts.push(account);
  await saveRegistry({ v: 2, accounts, activeId: account.uid });
  await storageSet(ONBOARDED_KEY, true);

  let importedLocal = false;
  if (res.created) {
    const local = prevActive?.local ? prevActive : null;
    let ops: SyncOp[];
    if (local) {
      const v = await readView(local.uid);
      ops = [
        ...Object.values(v.categories).map(c => ({ kind: 'category' as const, id: c.id, op: 'upsert' as const, data: { ...c } })),
        ...Object.values(v.tasks).map(t => ({ kind: 'task' as const, id: t.id, op: 'upsert' as const, data: { ...t } })),
      ];
    } else {
      const cats = defaultCategoryOps();
      ops = [...cats, ...welcomeTaskOps(cats)];
    }
    await mutate(account, ops);
    if (local) {
      accounts = accounts.filter(a => a.uid !== local.uid);
      await saveRegistry({ v: 2, accounts, activeId: account.uid });
      await purgeLocal(local.uid);
      importedLocal = true;
    }
  } else {
    void sync(account);
  }
  return { account, importedLocal };
}

/** Run Google's sign-in window and return a verified-by-Google ID token. */
export async function googleIdToken(clientId: string): Promise<{ idToken: string; nonce: string }> {
  if (!chrome.identity?.launchWebAuthFlow) throw new Error('Google sign-in works inside the Chrome extension only.');
  const nonce = newId();
  const url =
    'https://accounts.google.com/o/oauth2/v2/auth?' +
    new URLSearchParams({
      client_id: clientId,
      response_type: 'id_token',
      redirect_uri: chrome.identity.getRedirectURL(),
      scope: 'openid email profile',
      nonce,
      prompt: 'select_account',
    }).toString();
  let responseUrl: string | undefined;
  try {
    responseUrl = await chrome.identity.launchWebAuthFlow({ url, interactive: true });
  } catch (e) {
    const msg = (e as Error)?.message ?? '';
    // "The user did not approve access." = window closed / cancelled.
    throw new Error(/did not approve|canceled|cancelled/i.test(msg) ? 'Sign-in was cancelled.' : `Google sign-in failed: ${msg}`);
  }
  const params = new URLSearchParams(new URL(responseUrl ?? 'x:').hash.replace(/^#/, ''));
  const idToken = params.get('id_token');
  if (!idToken) {
    const err = params.get('error');
    throw new Error(err === 'access_denied' ? 'Sign-in was cancelled.' : `Google sign-in failed${err ? `: ${err}` : '.'}`);
  }
  return { idToken, nonce };
}

/** Full Google flow: Google window → our API → stored session. */
export async function signInWithGoogle(clientId: string) {
  const { idToken, nonce } = await googleIdToken(clientId);
  return completeSignIn(await api.google(idToken, nonce));
}
