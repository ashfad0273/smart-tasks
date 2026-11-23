import CategoriesScreen from './screens/CategoriesScreen';
import Dashboard from './screens/Dashboard';
import Login from './screens/Login';
import Reset from './screens/Reset';
import SettingsScreen from './screens/SettingsScreen';
import AgentScreen from './screens/AgentScreen';
import Signup from './screens/Signup';
import Welcome from './screens/Welcome';
import CategoryModal from './components/CategoryModal';
import ConfirmDialog from './components/ConfirmDialog';
import EditTaskSheet from './components/EditTaskSheet';
import Splash from './components/Splash';
import SwitchAccountModal from './components/SwitchAccountModal';
import Toast from './components/Toast';
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
  if (app.screen === 'categories') return <CategoriesScreen />;
  if (app.screen === 'settings') return <SettingsScreen />;
  if (app.screen === 'agent') return <AgentScreen />;
  return <Dashboard />;
}

function Root() {
  const app = useApp();
  if (!app.booted) return <Splash />;
  return (
    <>
      {/* Re-keyed per screen so every navigation fades in. */}
      <div key={app.account ? app.screen : `out-${app.screen}`} className="anim-screen h-full">
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
