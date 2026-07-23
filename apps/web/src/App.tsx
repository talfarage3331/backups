import { useState, useEffect } from 'react';
import { CheckCircle } from 'lucide-react';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/Auth';
import Onboarding from './pages/Onboarding';
import Dashboard from './pages/Dashboard';
import Pipelines from './pages/Pipelines';
import Settings from './pages/Settings';
import SchemaExplorer from './pages/SchemaExplorer';
import Environments from './pages/Environments';
import Sidebar from './components/Sidebar';
import { subscribeToPipelines } from './services/db';
import type { Pipeline } from './types';

type Page = 'dashboard' | 'pipelines' | 'settings' | 'schema' | 'environments';
type AppView = 'auth' | 'onboarding' | 'app' | 'loading';

function AppShell() {
  const { user, loading, signOut } = useAuth();
  const [view, setView] = useState<AppView>('loading');
  const [page, setPage] = useState<Page>('dashboard');
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);

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

  // 3. Listen for global toast notifications and navigation events
  useEffect(() => {
    function handleShowToast(e: Event) {
      const customEvent = e as CustomEvent<string>;
      const message = customEvent.detail;
      const id = Math.random().toString();
      setToasts(prev => [...prev, { id, message }]);
      setTimeout(() => {
        setToasts(prev => prev.filter(t => t.id !== id));
      }, 3000);
    }

    function handleNavigatePipelines() {
      setPage('pipelines');
    }

    window.addEventListener('show-toast', handleShowToast);
    window.addEventListener('navigate-pipelines', handleNavigatePipelines);
    return () => {
      window.removeEventListener('show-toast', handleShowToast);
      window.removeEventListener('navigate-pipelines', handleNavigatePipelines);
    };
  }, []);

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
      {/* Toast Render */}
      <div style={{ position: 'fixed', bottom: 24, right: 24, display: 'flex', flexDirection: 'column', gap: 8, zIndex: 10000 }}>
        {toasts.map(t => (
          <div
            key={t.id}
            className="card animate-slide-up"
            style={{
              padding: '12px 18px',
              background: 'var(--bg-surface)',
              border: '1px solid var(--accent-green-border)',
              boxShadow: 'var(--shadow-lg)',
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              minWidth: 280
            }}
          >
            <CheckCircle size={16} color="var(--accent-green)" />
            <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{t.message}</span>
          </div>
        ))}
      </div>

      <Sidebar
        activePage={page}
        onNavigate={(p) => setPage(p)}
        activePipelinesCount={activeCount}
        piiAlertCount={1}
      />
      {page === 'dashboard'    && <Dashboard key="dashboard" />}
      {page === 'pipelines'    && <Pipelines key="pipelines" />}
      {page === 'schema'       && <SchemaExplorer key="schema" />}
      {page === 'environments' && <Environments key="environments" />}
      {page === 'settings'     && (
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
