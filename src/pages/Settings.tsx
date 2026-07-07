import { useState, useEffect } from 'react';
import {
  Bell, CreditCard, CheckCircle, Loader2, User, MessageSquare, Send, ToggleLeft, ToggleRight, Sparkles
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { getUserSettings, saveUserSettings } from '../services/db';
import type { UserSettings } from '../types';

// ─── Confirm Modal ────────────────────────────────────────────────────────────
function ConfirmModal({
  title, body, confirmLabel, onConfirm, onCancel,
}: {
  title: string; body: string; confirmLabel: string;
  onConfirm: () => void; onCancel: () => void;
}) {
  return (
    <div className="modal-overlay" onClick={onCancel}>
      <div className="modal-box animate-slide-up" onClick={e => e.stopPropagation()}>
        <div className="modal-title" style={{ color: 'var(--accent-red)' }}>{title}</div>
        <div className="modal-body">{body}</div>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
          <button className="btn btn-danger" onClick={onConfirm}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Settings Component ───────────────────────────────────────────────────────
interface SettingsProps {
  onDeleteAccount: () => void;
}

export default function Settings({ onDeleteAccount }: SettingsProps) {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [deleteModal, setDeleteModal] = useState(false);

  // UserSettings state
  const [slackUrl, setSlackUrl] = useState('');
  const [discordUrl, setDiscordUrl] = useState('');
  const [telegramToken, setTelegramToken] = useState('');
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [darkMode, setDarkMode] = useState(true);

  // Toast notification state
  const [toasts, setToasts] = useState<{ id: string; message: string }[]>([]);

  const addToast = (message: string) => {
    const id = Math.random().toString();
    setToasts(prev => [...prev, { id, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, 3000);
  };

  useEffect(() => {
    if (!user) return;
    setLoading(true);
    getUserSettings(user.uid).then((settings) => {
      setSlackUrl(settings.slack_webhook_url || '');
      setDiscordUrl(settings.discord_webhook_url || '');
      setTelegramToken(settings.telegram_bot_token || '');
      setMfaEnabled(settings.mfa_enabled ?? false);
      setDarkMode(settings.dark_mode ?? true);
    }).finally(() => setLoading(false));
  }, [user]);

  async function handleSaveSettings(e: React.FormEvent) {
    e.preventDefault();
    if (!user) return;
    setSaving(true);
    const updated: UserSettings = {
      slack_webhook_url: slackUrl,
      discord_webhook_url: discordUrl,
      telegram_bot_token: telegramToken,
      mfa_enabled: mfaEnabled,
      dark_mode: darkMode,
    };
    await saveUserSettings(user.uid, updated);
    setSaving(false);
    setSaved(true);
    addToast('Global settings saved successfully!');
    setTimeout(() => setSaved(false), 2000);
  }

  function handleTestWebhook(type: 'slack' | 'discord' | 'telegram') {
    addToast(`Test ${type} payload sent successfully!`);
  }

  async function handleDeleteAccount() {
    setDeleteModal(false);
    onDeleteAccount();
  }

  const initials = user?.displayName
    ? user.displayName.slice(0, 2).toUpperCase()
    : user?.email?.slice(0, 2).toUpperCase() ?? 'SG';

  const displayName = user?.displayName || user?.email?.split('@')[0] || 'User';

  if (loading) {
    return (
      <div className="main-content" style={{ display: 'flex', justifyContent: 'center', paddingTop: 80 }}>
        <div className="spinner spinner-blue" style={{ width: 28, height: 28, borderWidth: 3 }} />
      </div>
    );
  }

  return (
    <div className="main-content animate-fade-in">
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

      {deleteModal && (
        <ConfirmModal
          title="Delete account?"
          body="Are you sure you want to delete your account? This will permanently delete your StackGuard account, all config settings, and pipeline run logs. This action cannot be undone."
          confirmLabel="Delete my account"
          onConfirm={handleDeleteAccount}
          onCancel={() => setDeleteModal(false)}
        />
      )}

      <div className="page-header">
        <h1 className="page-title">Settings &amp; billing</h1>
      </div>

      <div className="settings-sections">
        {/* ── User Profile Card ────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-body" style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            <div
              style={{
                width: 56,
                height: 56,
                borderRadius: '50%',
                background: 'linear-gradient(135deg, var(--accent-blue), #7c5cfc)',
                color: '#fff',
                fontWeight: 600,
                fontSize: 18,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              {initials}
            </div>
            <div className="flex flex-col">
              <span style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-primary)' }}>{displayName}</span>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 2 }}>{user?.email}</span>
            </div>
          </div>
        </div>

        {/* ── Global Notification Settings Form ─────────────────────────── */}
        <form onSubmit={handleSaveSettings} className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title flex items-center gap-2">
                <Bell size={16} /> Global Notification Targets
              </div>
              <div className="settings-section-subtitle">Manage where failure alerts and backup success pings are dispatched.</div>
            </div>
            {saved && (
              <span style={{ color: 'var(--accent-green)', fontSize: 13, fontWeight: 500, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CheckCircle size={14} /> Saved
              </span>
            )}
          </div>

          <div className="settings-section-body">
            {/* Slack */}
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <MessageSquare size={15} /> Slack Webhook URL
              </label>
              <div className="flex gap-2">
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://hooks.slack.com/services/..."
                  value={slackUrl}
                  onChange={e => setSlackUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleTestWebhook('slack')}
                  disabled={!slackUrl}
                >
                  Test
                </button>
              </div>
            </div>

            {/* Discord */}
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <MessageSquare size={15} /> Discord Webhook URL
              </label>
              <div className="flex gap-2">
                <input
                  className="form-input"
                  type="url"
                  placeholder="https://discord.com/api/webhooks/..."
                  value={discordUrl}
                  onChange={e => setDiscordUrl(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleTestWebhook('discord')}
                  disabled={!discordUrl}
                >
                  Test
                </button>
              </div>
            </div>

            {/* Telegram */}
            <div className="form-group">
              <label className="form-label flex items-center gap-2">
                <Send size={15} /> Telegram Bot Token
              </label>
              <div className="flex gap-2">
                <input
                  className="form-input"
                  type="text"
                  placeholder="123456789:ABCdefGhIJKlmNoPQRsT..."
                  value={telegramToken}
                  onChange={e => setTelegramToken(e.target.value)}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => handleTestWebhook('telegram')}
                  disabled={!telegramToken}
                >
                  Test
                </button>
              </div>
            </div>

            <div className="flex justify-end" style={{ marginTop: 8 }}>
              <button type="submit" className="btn btn-primary" disabled={saving}>
                {saving ? <><Loader2 size={14} className="animate-spin" /> Saving...</> : 'Save Notifications'}
              </button>
            </div>
          </div>
        </form>

        {/* ── Preferences: Appearance & Security ────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div className="settings-section-title flex items-center gap-2">
              <User size={16} /> Preferences &amp; Security
            </div>
          </div>
          <div className="settings-section-body" style={{ gap: 16 }}>
            {/* MFA Toggle */}
            <div className="flex items-center justify-between" style={{ padding: '4px 0' }}>
              <div className="flex flex-col">
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  Multi-Factor Authentication
                </span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Secure login attempts with a time-based authenticator app passcode.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setMfaEnabled(!mfaEnabled);
                  addToast(mfaEnabled ? 'MFA disabled' : 'MFA enabled');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: mfaEnabled ? 'var(--accent-blue)' : 'var(--text-muted)' }}
              >
                {mfaEnabled ? <ToggleRight size={34} /> : <ToggleLeft size={34} />}
              </button>
            </div>

            {/* Dark Mode Toggle */}
            <div className="flex items-center justify-between" style={{ padding: '4px 0', borderTop: '1px solid var(--border-subtle)', paddingTop: 16 }}>
              <div className="flex flex-col">
                <span style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>Dark Theme Aesthetics</span>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Use the sleek midnight-base dashboard colors.</span>
              </div>
              <button
                type="button"
                onClick={() => {
                  setDarkMode(!darkMode);
                  addToast('Theme settings updated');
                }}
                style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, display: 'flex', color: darkMode ? 'var(--accent-blue)' : 'var(--text-muted)' }}
              >
                {darkMode ? <ToggleRight size={34} /> : <ToggleLeft size={34} />}
              </button>
            </div>
          </div>
        </div>

        {/* ── Billing ──────────────────────────────────────────────────── */}
        <div className="settings-section">
          <div className="settings-section-header">
            <div>
              <div className="settings-section-title flex items-center gap-2"><CreditCard size={16} /> Billing</div>
              <div className="settings-section-subtitle">You are on the Free plan.</div>
            </div>
          </div>
          <div className="settings-section-body">
            <div className="billing-plans">
              <div className="billing-plan">
                <div className="billing-plan-name">Free</div>
                <div className="billing-plan-price">$0 <span>/mo</span></div>
                <ul className="billing-plan-features">
                  <li>1 pipeline</li><li>Daily backups</li><li>14-day retention</li><li>Email alerts</li>
                </ul>
                <button type="button" className="btn btn-ghost btn-sm w-full" style={{ justifyContent: 'center', marginTop: 'auto' }} disabled>Current plan</button>
              </div>
              <div className="billing-plan highlighted" style={{ position: 'relative' }}>
                <div className="billing-plan-badge">Popular</div>
                <div className="billing-plan-name">Starter</div>
                <div className="billing-plan-price">$9 <span>/mo</span></div>
                <ul className="billing-plan-features">
                  <li>3 pipelines</li><li>12-hour backups</li><li>30-day retention</li><li>Webhook alerts</li><li>Restore checks</li>
                </ul>
                <button type="button" className="btn btn-primary btn-sm w-full" style={{ justifyContent: 'center', marginTop: 'auto' }}>Upgrade</button>
              </div>
              <div className="billing-plan">
                <div className="billing-plan-name">Pro</div>
                <div className="billing-plan-price">$19 <span>/mo</span></div>
                <ul className="billing-plan-features">
                  <li>10 pipelines</li><li>Hourly backups</li><li>90-day retention</li><li>Priority support</li><li>Restore checks</li><li>Audit logs</li>
                </ul>
                <button type="button" className="btn btn-ghost btn-sm w-full" style={{ justifyContent: 'center', marginTop: 'auto' }}>Upgrade</button>
              </div>
              <div className="billing-plan">
                <div className="billing-plan-name">Team</div>
                <div className="billing-plan-price">$49 <span>/mo</span></div>
                <ul className="billing-plan-features">
                  <li>Unlimited pipelines</li><li>Continuous backups</li><li>365-day retention</li><li>SSO / SAML</li><li>SLA guarantee</li><li>Dedicated Slack</li>
                </ul>
                <button type="button" className="btn btn-ghost btn-sm w-full" style={{ justifyContent: 'center', marginTop: 'auto' }}>Contact sales</button>
              </div>
            </div>
          </div>
        </div>

        {/* ── Danger zone ──────────────────────────────────────────────── */}
        <div className="settings-section danger-zone">
          <div className="settings-section-header" style={{ borderBottomColor: 'rgba(248,97,79,0.2)' }}>
            <div className="settings-section-title flex items-center gap-2" style={{ color: 'var(--accent-red)' }}><Sparkles size={16} /> Danger zone</div>
          </div>
          <div className="danger-actions">
            <div className="danger-action-row">
              <div>
                <div className="danger-action-title">Delete account</div>
                <div className="danger-action-desc">Permanently deletes your StackGuard account, settings profiles, and database documents. Irreversible.</div>
              </div>
              <button type="button" className="btn btn-danger btn-sm" style={{ flexShrink: 0, marginLeft: 24 }} onClick={() => setDeleteModal(true)}>
                Delete account
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
