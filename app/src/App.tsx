import { useState, useEffect } from 'react';
import Onboarding from './components/Onboarding';

function App() {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    // Small delay to let things initialize
    setTimeout(() => setReady(true), 100);
  }, []);

  if (!ready) {
    return (
      <div className="onboarding">
        <div className="header">
          <img src="/system_white.svg" alt="SYSTEM" className="logo-img" />
        </div>
      </div>
    );
  }

  return <Onboarding onComplete={() => {}} />;
}

export default App;
