import CategoriesScreen from './screens/CategoriesScreen';
import Dashboard from './screens/Dashboard';
import Login from './screens/Login';
import Reset from './screens/Reset';
import SettingsScreen from './screens/SettingsScreen';
import AgentScreen from './screens/AgentScreen';
import DevicesScreen from './screens/DevicesScreen';
import ActivityScreen from './screens/ActivityScreen';
import ArchiveScreen from './screens/ArchiveScreen';
import NotificationsScreen from './screens/NotificationsScreen';
import Signup from './screens/Signup';
import Welcome from './screens/Welcome';
import Onboarding from './screens/Onboarding';
import CategoryModal from './components/CategoryModal';
import ConfirmDialog from './components/ConfirmDialog';
import EditTaskSheet from './components/EditTaskSheet';
import Splash from './components/Splash';
import SwitchAccountModal from './components/SwitchAccountModal';
import Toast from './components/Toast';
import Sidebar from './components/Sidebar';
import DesktopSettings from './screens/DesktopSettings';
import { useWide } from './hooks/useWide';
import { AppProvider, useApp } from './state/AppContext';

function Screen() {
  const app = useApp();
  switch (app.screen) {
    case 'welcome':
      return <Welcome />;
    case 'login':
      return <Login />;
    case 'signup':
      return <Signup />;
    case 'reset':
      return <Reset />;
  }
  if (!app.account) return app.accounts.length ? <Login /> : <Welcome />;
  if (app.tour) return <Onboarding />;
  if (app.screen === 'categories') return <CategoriesScreen />;
  if (app.screen === 'settings') return <SettingsScreen />;
  if (app.screen === 'agent') return <AgentScreen />;
  if (app.screen === 'devices') return <DevicesScreen />;
  if (app.screen === 'activity') return <ActivityScreen />;
  if (app.screen === 'archive') return <ArchiveScreen />;
  if (app.screen === 'notifications') return <NotificationsScreen />;
  return <Dashboard />;
}

/** Pages that read best as a column, not stretched across a wide window. */
const NARROW_PAGES = new Set(['activity', 'archive', 'notifications', 'devices', 'categories']);

/** Desktop app, wide window: sidebar + page + docked task panel. */
function Shell() {
  const app = useApp();
  const page = app.screen === 'settings' ? <DesktopSettings /> : <Screen />;
  return (
    <div className="st-shell flex h-full">
      <Sidebar />
      <main className="@container relative min-w-0 flex-1 overflow-hidden">
        <div key={app.screen} className="anim-screen h-full">
          {NARROW_PAGES.has(app.screen) ? <div className="mx-auto h-full max-w-[720px]">{page}</div> : page}
        </div>
      </main>
      {app.editTaskId && <EditTaskSheet docked key={app.editTaskId} />}
    </div>
  );
}

const AUTH_SCREENS = new Set(['welcome', 'login', 'signup', 'reset']);

function Root() {
  const app = useApp();
  const wide = useWide();
  if (!app.booted) return <Splash />;
  if (wide && app.account && !app.tour && !AUTH_SCREENS.has(app.screen)) {
    return (
      <>
        <Shell />
        {app.switcherOpen && <SwitchAccountModal />}
        {app.categoryModal && <CategoryModal key={app.categoryModal.mode === 'edit' ? app.categoryModal.id : 'new'} />}
        <ConfirmDialog />
        <Toast />
      </>
    );
  }
  return (
    <>
      {/* Re-keyed per screen so every navigation fades in. */}
      <div key={app.account ? (app.tour ? 'tour' : app.screen) : `out-${app.screen}`} className="anim-screen h-full">
        <Screen />
      </div>
      {app.account && app.editTaskId && <EditTaskSheet key={app.editTaskId} />}
      {app.switcherOpen && <SwitchAccountModal />}
      {app.categoryModal && <CategoryModal key={app.categoryModal.mode === 'edit' ? app.categoryModal.id : 'new'} />}
      <ConfirmDialog />
      <Toast />
    </>
  );
}

export default function App() {
  return (
    <AppProvider>
      <Root />
    </AppProvider>
  );
}
