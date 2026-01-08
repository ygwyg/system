import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-shell';
import { getCurrentWindow } from '@tauri-apps/api/window';

interface OnboardingProps {
  onComplete: (url?: string) => void;
}

type Step = 'welcome' | 'permissions' | 'app_permissions' | 'apikey' | 'starting' | 'ready';

interface Permission {
  id: string;
  name: string;
  description: string;
  granted: boolean;
}

interface AppPermission {
  name: string;
  icon: string;
  status: 'pending' | 'checking' | 'granted' | 'denied';
}

const PERMISSIONS: Permission[] = [
  { id: 'accessibility', name: 'Accessibility', description: 'Control keyboard and mouse', granted: false },
  { id: 'screen_recording', name: 'Screen Recording', description: 'Take screenshots', granted: false },
  { id: 'full_disk', name: 'Full Disk Access', description: 'Read iMessages and files', granted: false },
  { id: 'contacts', name: 'Contacts', description: 'Look up contacts', granted: false },
  { id: 'automation', name: 'Automation', description: 'Control other apps', granted: false },
];

// Map app names to their SF Symbol or emoji icons
const APP_ICONS: Record<string, string> = {
  'Calendar': '📅',
  'Contacts': '👤',
  'Finder': '📁',
  'Messages': '💬',
  'Music': '🎵',
  'Notes': '📝',
  'Reminders': '☑️',
  'Safari': '🧭',
  'Google Chrome': '🌐',
  'System Events': '⚙️',
};

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [permissions, setPermissions] = useState<Permission[]>(PERMISSIONS);
  const [appPermissions, setAppPermissions] = useState<AppPermission[]>([]);
  const [currentAppIndex, setCurrentAppIndex] = useState(-1);
  const [apiKey, setApiKey] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tunnelUrl, setTunnelUrl] = useState<string | null>(null);
  const [apiSecret, setApiSecret] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [copied, setCopied] = useState(false);
  const [copiedPassword, setCopiedPassword] = useState(false);

  // Check if already configured on mount
  useEffect(() => {
    checkExistingConfig();
  }, []);

  useEffect(() => {
    if (step === 'permissions') {
      checkPermissions();
    }
    if (step === 'app_permissions') {
      loadAppPermissions();
    }
  }, [step]);

  async function checkExistingConfig() {
    try {
      const config = await invoke<{ configured: boolean; tunnelUrl?: string }>('check_config');
      if (config.configured) {
        // API key exists, skip to starting
        setStep('apikey'); // Show briefly then auto-start
        // Small delay so user sees what's happening
        setTimeout(() => handleStartWithExistingKey(), 500);
      }
    } catch (e) {
      console.error('Failed to check config:', e);
    }
  }

  async function handleStartWithExistingKey() {
    setIsLoading(true);
    setError(null);
    setStep('starting');
    
    try {
      setStatusMessage('Starting local server...');
      const generatedSecret = await invoke<string>('start_local_server');
      setApiSecret(generatedSecret);
      
      setStatusMessage('Creating secure tunnel...');
      const result = await invoke<{ success: boolean; url?: string; apiSecret?: string; error?: string }>('start_tunnel');
      
      if (result.success && result.url) {
        setTunnelUrl(result.url);
        if (result.apiSecret) {
          setApiSecret(result.apiSecret);
        }
        setStep('ready');
      } else {
        setError(result.error || 'Failed to start tunnel');
        setStep('apikey');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('apikey');
    } finally {
      setIsLoading(false);
    }
  }

  async function loadAppPermissions() {
    try {
      const appsWithStatus = await invoke<[string, boolean][]>('get_automation_apps_with_status');
      setAppPermissions(appsWithStatus.map(([name, granted]) => ({
        name,
        icon: APP_ICONS[name] || '📦',
        status: granted ? 'granted' as const : 'pending' as const,
      })));
    } catch (e) {
      console.error('Failed to load automation apps:', e);
    }
  }

  async function startPrewarming() {
    const pendingApps = appPermissions
      .map((app, idx) => ({ ...app, idx }))
      .filter(app => app.status === 'pending');
    
    for (const app of pendingApps) {
      setCurrentAppIndex(app.idx);
      setAppPermissions(prev => prev.map((a, idx) => 
        idx === app.idx ? { ...a, status: 'checking' } : a
      ));
      
      try {
        const granted = await invoke<boolean>('prewarm_app', { appName: app.name });
        setAppPermissions(prev => prev.map((a, idx) => 
          idx === app.idx ? { ...a, status: granted ? 'granted' : 'denied' } : a
        ));
      } catch (e) {
        setAppPermissions(prev => prev.map((a, idx) => 
          idx === app.idx ? { ...a, status: 'denied' } : a
        ));
      }
      
      // Small delay between apps so user can see progress
      await new Promise(resolve => setTimeout(resolve, 300));
    }
    setCurrentAppIndex(-1);
  }

  async function checkPermissions() {
    try {
      const results = await invoke<Record<string, boolean>>('check_permissions');
      setPermissions(perms => perms.map(p => ({
        ...p,
        granted: results[p.id] || false,
      })));
    } catch (e) {
      console.error('Failed to check permissions:', e);
    }
  }

  async function requestPermission(permId: string) {
    try {
      await invoke('request_permission', { permission: permId });
      const interval = setInterval(checkPermissions, 1000);
      setTimeout(() => clearInterval(interval), 30000);
    } catch (e) {
      console.error('Failed to request permission:', e);
    }
  }

  async function handleStart() {
    setIsLoading(true);
    setError(null);
    setStep('starting');
    
    try {
      setStatusMessage('Saving configuration...');
      await invoke('save_api_key', { apiKey });
      
      setStatusMessage('Starting local server...');
      // start_local_server now returns the generated API secret
      const generatedSecret = await invoke<string>('start_local_server');
      setApiSecret(generatedSecret);
      
      setStatusMessage('Creating secure tunnel...');
      const result = await invoke<{ success: boolean; url?: string; apiSecret?: string; error?: string }>('start_tunnel');
      
      if (result.success && result.url) {
        setTunnelUrl(result.url);
        // Use the apiSecret from result if available, otherwise use the one from start_local_server
        if (result.apiSecret) {
          setApiSecret(result.apiSecret);
        }
        setStep('ready');
      } else {
        setError(result.error || 'Failed to start tunnel');
        setStep('apikey');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStep('apikey');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleCopyUrl() {
    if (!tunnelUrl) return;
    try {
      await navigator.clipboard.writeText(tunnelUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (e) {
      console.error('Copy failed:', e);
    }
  }

  async function handleOpenInBrowser() {
    if (!tunnelUrl) return;
    try {
      await open(tunnelUrl);
    } catch (e) {
      console.error('Failed to open browser:', e);
      // Fallback
      window.open(tunnelUrl, '_blank');
    }
  }

  async function handleDone() {
    try {
      const win = getCurrentWindow();
      await win.hide();
    } catch (e) {
      console.error('Failed to hide window:', e);
    }
    onComplete(tunnelUrl || undefined);
  }

  const grantedCount = permissions.filter(p => p.granted).length;

  return (
    <div className="onboarding">
      <div className="header">
        <img src="/system_white.svg" alt="SYSTEM" className="logo-img" />
        <h1 className="logo-text">SYSTEM</h1>
        <p className="tagline">control your mac from anywhere</p>
      </div>
      
      <div className="content">
        {step === 'welcome' && (
          <div className="step-content">
            <div className="step-body">
              <p className="description">
                Control your Mac remotely using AI. No account needed.
              </p>
            </div>
            <div className="step-footer">
              <button className="btn btn-primary" onClick={() => setStep('permissions')}>
                Get Started
              </button>
            </div>
          </div>
        )}

        {step === 'permissions' && (
          <div className="step-content">
            <div className="step-body">
              <h2 className="step-title">Permissions</h2>
              <p className="description">Grant permissions to enable features. All optional.</p>
              
              <div className="perm-list">
                {permissions.map(perm => (
                  <div 
                    key={perm.id}
                    className={`perm-item ${perm.granted ? 'granted' : ''}`}
                    onClick={() => !perm.granted && requestPermission(perm.id)}
                  >
                    <div className="perm-check">{perm.granted ? '✓' : ''}</div>
                    <div className="perm-info">
                      <span className="perm-name">{perm.name}</span>
                      <span className="perm-desc">{perm.description}</span>
                    </div>
                  </div>
                ))}
              </div>
              
              <p className="hint">{grantedCount}/{permissions.length} granted</p>
            </div>
            <div className="step-footer">
              <button className="btn btn-primary" onClick={() => setStep('app_permissions')}>
                Continue
              </button>
            </div>
          </div>
        )}

        {step === 'app_permissions' && (
          <div className="step-content">
            <div className="step-body">
              <h2 className="step-title">App Permissions</h2>
              <p className="description">
                {(() => {
                  const pendingCount = appPermissions.filter(a => a.status === 'pending').length;
                  const grantedAppCount = appPermissions.filter(a => a.status === 'granted').length;
                  
                  if (currentAppIndex >= 0) {
                    return `Requesting permission for ${appPermissions[currentAppIndex]?.name}...`;
                  } else if (pendingCount === 0) {
                    return "All app permissions granted!";
                  } else if (grantedAppCount > 0) {
                    return `${grantedAppCount} already granted. ${pendingCount} more needed.`;
                  } else {
                    return "Grant permissions for apps SYSTEM will control.";
                  }
                })()}
              </p>
              
              <div className="app-grid">
                {appPermissions.map((app) => (
                  <div 
                    key={app.name}
                    className={`app-icon-item ${app.status}`}
                    title={app.name}
                  >
                    <span className="app-icon">{app.icon}</span>
                    <span className="app-name">{app.name}</span>
                    {app.status === 'checking' && <div className="app-spinner" />}
                    {app.status === 'granted' && <span className="app-status granted">✓</span>}
                    {app.status === 'denied' && <span className="app-status denied">✕</span>}
                  </div>
                ))}
              </div>
              
              {appPermissions.some(a => a.status === 'pending') && !appPermissions.some(a => a.status === 'checking') && (
                <button className="btn btn-secondary" onClick={startPrewarming}>
                  Grant Permissions
                </button>
              )}
              {appPermissions.some(a => a.status === 'checking') && (
                <p className="hint">Respond to the permission dialogs...</p>
              )}
            </div>
            <div className="step-footer">
              <button className="btn btn-primary" onClick={() => setStep('apikey')}>
                {appPermissions.every(a => a.status !== 'pending') ? 'Continue' : 'Skip for now'}
              </button>
            </div>
          </div>
        )}

        {step === 'apikey' && (
          <div className="step-content">
            <div className="step-body">
              <h2 className="step-title">Anthropic API Key</h2>
              <p className="description">Your key stays local, only sent to Anthropic.</p>
              
              <input 
                type="password"
                className="text-input"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoFocus
              />
              
              {error && <div className="error-box">{error}</div>}
              
              <a 
                className="text-link"
                href="https://console.anthropic.com/settings/keys"
                target="_blank"
                rel="noopener noreferrer"
              >
                Get an API key
              </a>
            </div>
            <div className="step-footer">
              <button 
                className="btn btn-primary" 
                onClick={handleStart}
                disabled={!apiKey.startsWith('sk-ant-') || isLoading}
              >
                Start SYSTEM
              </button>
            </div>
          </div>
        )}

        {step === 'starting' && (
          <div className="step-content">
            <div className="step-body centered">
              <h2 className="step-title">Starting SYSTEM</h2>
              <div className="spinner-container">
                <div className="spinner" />
              </div>
              <p className="status-text">{statusMessage}</p>
            </div>
          </div>
        )}

        {step === 'ready' && tunnelUrl && (
          <div className="step-content">
            <div className="step-body">
              <h2 className="step-title">SYSTEM is Running</h2>
              <p className="description">Access your Mac from anywhere:</p>
              
              <div className="credential-group">
                <label className="credential-label">URL</label>
                <div className="url-box" onClick={handleCopyUrl}>
                  <span className="url-text">{tunnelUrl}</span>
                  <span className="url-hint">{copied ? 'Copied!' : 'Click to copy'}</span>
                </div>
              </div>
              
              {apiSecret && (
                <div className="credential-group">
                  <label className="credential-label">Password</label>
                  <div className="password-box">
                    <input
                      type="password"
                      className="password-input"
                      value={apiSecret}
                      readOnly
                    />
                    <button 
                      className="copy-btn"
                      onClick={() => {
                        navigator.clipboard.writeText(apiSecret);
                        setCopiedPassword(true);
                        setTimeout(() => setCopiedPassword(false), 2000);
                      }}
                      title="Copy password"
                    >
                      {copiedPassword ? '✓' : '⧉'}
                    </button>
                  </div>
                </div>
              )}
              
              <p className="hint">SYSTEM will keep running in the menu bar</p>
            </div>
            <div className="step-footer">
              <button className="btn btn-primary" onClick={handleOpenInBrowser}>
                Open in Browser
              </button>
              <button className="btn btn-secondary" onClick={handleDone}>
                Close Window
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
