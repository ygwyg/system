import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

interface OnboardingProps {
  onComplete: (deployedUrl?: string) => void;
}

type Step = 'welcome' | 'permissions' | 'apikey' | 'mode' | 'deploy' | 'complete';

interface Permission {
  id: string;
  name: string;
  description: string;
  features: string[];
  required: boolean;
  granted: boolean;
}

const PERMISSIONS: Permission[] = [
  { 
    id: 'full_disk', 
    name: 'Full Disk Access', 
    description: 'Read iMessages and access files',
    features: ['Read iMessages', 'Access Downloads', 'Read Notes'],
    required: false,
    granted: false 
  },
  { 
    id: 'accessibility', 
    name: 'Accessibility', 
    description: 'Control keyboard and mouse',
    features: ['Type text', 'Click buttons', 'Keyboard shortcuts'],
    required: false,
    granted: false 
  },
  { 
    id: 'contacts', 
    name: 'Contacts', 
    description: 'Look up contacts by name',
    features: ['Find contact phone numbers', 'Send messages to contacts'],
    required: false,
    granted: false 
  },
  { 
    id: 'automation', 
    name: 'Automation', 
    description: 'Control other applications',
    features: ['Control Spotify', 'Open apps', 'Run Raycast commands'],
    required: false,
    granted: false 
  },
];

export default function Onboarding({ onComplete }: OnboardingProps) {
  const [step, setStep] = useState<Step>('welcome');
  const [permissions, setPermissions] = useState<Permission[]>(PERMISSIONS);
  const [apiKey, setApiKey] = useState('');
  const [mode, setMode] = useState<'remote' | 'local'>('remote');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deployedUrl, setDeployedUrl] = useState<string | null>(null);

  const steps = ['welcome', 'permissions', 'apikey', 'mode', 'deploy'];
  const stepIndex = steps.indexOf(step);
  const totalSteps = steps.length;

  const grantedCount = permissions.filter(p => p.granted).length;

  useEffect(() => {
    if (step === 'permissions') {
      checkPermissions();
    }
  }, [step]);

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
      // Poll for permission changes
      const pollInterval = setInterval(async () => {
        await checkPermissions();
      }, 1000);
      
      // Stop polling after 30 seconds
      setTimeout(() => clearInterval(pollInterval), 30000);
    } catch (e) {
      console.error('Failed to request permission:', e);
    }
  }

  async function handleDeploy() {
    setIsLoading(true);
    setError(null);
    
    try {
      const result = await invoke<{ success: boolean; url?: string; error?: string }>('deploy', {
        apiKey,
        mode,
      });
      
      if (result.success) {
        setDeployedUrl(result.url || null);
        setStep('complete');
      } else {
        setError(result.error || 'Deployment failed');
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setIsLoading(false);
    }
  }

  return (
    <div className="onboarding">
      <div className="logo">
        <span className="logo-dot"></span>
        SYSTEM
      </div>
      <div className="tagline">control your mac from anywhere</div>
      
      <div className="steps">
        {Array.from({ length: totalSteps }).map((_, i) => (
          <div 
            key={i} 
            className={`step ${i < stepIndex ? 'completed' : ''} ${i === stepIndex ? 'active' : ''}`} 
          />
        ))}
      </div>

      <div className="content">
        {step === 'welcome' && (
          <>
            <h1 className="title">Welcome to SYSTEM</h1>
            <p className="description">
              Control your Mac from anywhere using AI. Let's get you set up in a few steps.
            </p>
            <button 
              className="button button-primary" 
              onClick={() => setStep('permissions')}
            >
              Get Started
            </button>
          </>
        )}

        {step === 'permissions' && (
          <>
            <h1 className="title">Permissions</h1>
            <p className="description">
              Grant permissions to enable features. All are optional — skip any you don't need.
            </p>
            <div className="permissions">
              {permissions.map(perm => (
                <div 
                  key={perm.id}
                  className={`permission ${perm.granted ? 'granted' : ''}`}
                  onClick={() => !perm.granted && requestPermission(perm.id)}
                >
                  <div className="permission-icon">
                    {perm.granted ? '✓' : ''}
                  </div>
                  <div className="permission-info">
                    <div className="permission-name">{perm.name}</div>
                    <div className="permission-desc">
                      {perm.granted 
                        ? perm.features.join(' · ')
                        : perm.description
                      }
                    </div>
                  </div>
                </div>
              ))}
            </div>
            <p className="description" style={{ marginBottom: '12px', fontSize: '11px' }}>
              {grantedCount === 0 
                ? 'Click each permission to grant access, or skip to continue.'
                : `${grantedCount} of ${permissions.length} permissions granted`
              }
            </p>
            <button 
              className="button button-primary" 
              onClick={() => setStep('apikey')}
            >
              {grantedCount === 0 ? 'Skip for now' : 'Continue'}
            </button>
          </>
        )}

        {step === 'apikey' && (
          <>
            <h1 className="title">Anthropic API Key</h1>
            <p className="description">
              Enter your Anthropic API key to power the AI assistant.
            </p>
            <div className="input-group">
              <label className="input-label">API Key</label>
              <input 
                type="password"
                className="input"
                placeholder="sk-ant-..."
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                autoFocus
              />
            </div>
            <button 
              className="button button-primary" 
              onClick={() => setStep('mode')}
              disabled={!apiKey.startsWith('sk-ant-')}
            >
              Continue
            </button>
          </>
        )}

        {step === 'mode' && (
          <>
            <h1 className="title">Access Mode</h1>
            <p className="description">
              How do you want to access SYSTEM?
            </p>
            <div className="permissions">
              <div 
                className={`permission ${mode === 'remote' ? 'granted' : ''}`}
                onClick={() => setMode('remote')}
              >
                <div className="permission-icon">
                  {mode === 'remote' ? '✓' : ''}
                </div>
                <div className="permission-info">
                  <div className="permission-name">Remote</div>
                  <div className="permission-desc">Access from anywhere via Cloudflare</div>
                </div>
              </div>
              <div 
                className={`permission ${mode === 'local' ? 'granted' : ''}`}
                onClick={() => setMode('local')}
              >
                <div className="permission-icon">
                  {mode === 'local' ? '✓' : ''}
                </div>
                <div className="permission-info">
                  <div className="permission-name">Local</div>
                  <div className="permission-desc">Access from this computer only</div>
                </div>
              </div>
            </div>
            <button 
              className="button button-primary" 
              onClick={() => setStep('deploy')}
            >
              Continue
            </button>
          </>
        )}

        {step === 'deploy' && (
          <>
            <h1 className="title">{mode === 'remote' ? 'Deploy to Cloudflare' : 'Finalize Setup'}</h1>
            <p className="description">
              {mode === 'remote' 
                ? 'Ready to deploy SYSTEM to Cloudflare Workers.'
                : 'Ready to configure SYSTEM for local access.'
              }
            </p>
            {error && (
              <div className="status" style={{ borderColor: 'var(--red)' }}>
                <div className="status-dot error" />
                <span style={{ fontSize: '11px', color: 'var(--text)' }}>{error}</span>
              </div>
            )}
            <button 
              className="button button-primary" 
              onClick={handleDeploy}
              disabled={isLoading}
            >
              {isLoading ? 'Setting up...' : (mode === 'remote' ? 'Deploy' : 'Complete Setup')}
            </button>
          </>
        )}

        {step === 'complete' && (
          <>
            <h1 className="title">Setup Complete</h1>
            <p className="description">
              SYSTEM is ready. You can access it from the menu bar.
            </p>
            {deployedUrl && (
              <div className="url-display">
                {deployedUrl}
              </div>
            )}
            <button 
              className="button button-primary" 
              onClick={() => onComplete(deployedUrl || undefined)}
            >
              Done
            </button>
          </>
        )}
      </div>
    </div>
  );
}
