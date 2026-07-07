import { LayoutDashboard, GitBranch, Settings, Shield, LogOut } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

type Page = 'dashboard' | 'pipelines' | 'settings';

interface SidebarProps {
  activePage: Page;
  onNavigate: (page: Page) => void;
  activePipelinesCount: number;
}

export default function Sidebar({ activePage, onNavigate, activePipelinesCount }: SidebarProps) {
  const { user, signOut } = useAuth();

  const initials = user?.displayName
    ? user.displayName.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? 'SG';

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <div className="sidebar-logo-icon">
          <Shield size={16} color="#fff" />
        </div>
        <span className="sidebar-logo-name">StackGuard</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <button
          id="nav-dashboard"
          className={`sidebar-link ${activePage === 'dashboard' ? 'active' : ''}`}
          onClick={() => onNavigate('dashboard')}
        >
          <LayoutDashboard size={17} />
          Dashboard
        </button>

        <button
          id="nav-pipelines"
          className={`sidebar-link ${activePage === 'pipelines' ? 'active' : ''}`}
          onClick={() => onNavigate('pipelines')}
        >
          <GitBranch size={17} />
          Pipelines
          {activePipelinesCount > 0 && (
            <span className="sidebar-badge">{activePipelinesCount}</span>
          )}
        </button>

        <button
          id="nav-settings"
          className={`sidebar-link ${activePage === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
        >
          <Settings size={17} />
          Settings &amp; billing
        </button>
      </nav>

      {/* User area */}
      <div className="sidebar-bottom">
        <div className="sidebar-user" onClick={signOut} title="Sign out">
          <div className="sidebar-avatar">{initials}</div>
          <div className="sidebar-user-info">
            <div className="sidebar-user-name">{displayName}</div>
            <div className="sidebar-user-email">{user?.email}</div>
          </div>
          <LogOut size={14} style={{ color: 'var(--text-muted)', marginLeft: 'auto', flexShrink: 0 }} />
        </div>
      </div>
    </aside>
  );
}
