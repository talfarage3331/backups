import { useState, useEffect } from 'react';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Pipelines from './pages/Pipelines';
import Settings from './pages/Settings';
import Sidebar from './components/Sidebar';
import { subscribeToPipelines } from './services/db';
import type { Pipeline } from './types';

type Page = 'dashboard' | 'pipelines' | 'settings';
type AppView = 'auth' | 'onboarding' | 'app' | 'loading';

function AppShell() {
  const { user, loading, signOut } = useAuth();
  const [view, setView] = useState<AppView>('loading');
  const [page, setPage] = useState<Page>('dashboard');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);

  // 1. Manage auth view changes
  useEffect(() => {
    if (loading) {
      setView('loading');
      return;
    }
    if (!user) {
      setView('auth');
      return;
    }
  }, [user, loading]);

  // 2. Subscribe to pipelines in real-time for view decisions and sidebar badges
  useEffect(() => {
    if (!user) return;

    const unsubscribe = subscribeToPipelines(user.uid, (data) => {
      setPipelines(data);
      if (data.length === 0) {
        setView('onboarding');
      } else {
        setView('app');
      }
    });

    return unsubscribe;
  }, [user]);

  const activeCount = pipelines.filter(p => p.status === 'active').length;

  const spinner = (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-base)' }}>
      <div className="spinner spinner-blue" style={{ width: 32, height: 32, borderWidth: 3 }} />
    </div>
  );

  if (view === 'loading') return spinner;
  if (view === 'auth') return <AuthPage onAuth={() => {}} />;
  if (view === 'onboarding') {
    return (
      <Onboarding
        onComplete={() => {
          setView('app');
          setPage('dashboard');
        }}
      />
    );
  }

  return (
    <div className="app-shell">
      <Sidebar
        activePage={page}
        onNavigate={(p) => setPage(p)}
        activePipelinesCount={activeCount}
      />
      {page === 'dashboard' && <Dashboard key="dashboard" />}
      {page === 'pipelines' && <Pipelines key="pipelines" />}
      {page === 'settings' && (
        <Settings
          onDeleteAccount={async () => {
            await signOut();
          }}
        />
      )}
    </div>
  );
}

export default function App() {
  return <AppShell />;
}
