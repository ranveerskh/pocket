import {useEffect, useLayoutEffect, useState} from 'react';
import {Monitor, Moon, Sun} from 'lucide-react';

type Theme = 'dark' | 'light' | 'system';
const KEY = 'pocket-theme';
function savedTheme(): Theme {
  try {
    const value = localStorage.getItem(KEY);
    if (value === 'light' || value === 'system') return value;
  } catch {}
  return 'dark';
}

export function useTheme() {
  const [theme, setTheme] = useState<Theme>(savedTheme);
  const [error, setError] = useState('');
  useLayoutEffect(() => {
    const system = window.matchMedia('(prefers-color-scheme: light)');
    function apply() {
      const light = theme === 'light' || (theme === 'system' && system.matches);
      document.documentElement.dataset.theme = light ? 'light' : 'dark';
      document.querySelector('meta[name="theme-color"]')?.setAttribute('content', light ? '#f4f3f8' : '#111214');
    }
    apply();
    system.addEventListener('change', apply);
    return () => system.removeEventListener('change', apply);
  }, [theme]);
  useEffect(() => {
    function changed(event: StorageEvent) {
      if (event.key === KEY) setTheme(savedTheme());
    }
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function choose(next: Theme) {
    setTheme(next);
    try { localStorage.setItem(KEY, next); setError(''); }
    catch { setError('Theme applied for this visit. This browser could not save the preference.'); }
  }
  return {theme, choose, error};
}

export default function ThemeSettings({service}: {service: ReturnType<typeof useTheme>}) {
  return <section className="panel settings-connection theme-settings" aria-label="Appearance">
    <h2>Appearance</h2>
    <div className="theme-choices" role="group" aria-label="Color theme">
      {([{value:'dark', label:'Dark', Icon:Moon}, {value:'light', label:'Light', Icon:Sun}, {value:'system', label:'System', Icon:Monitor}] as const).map(({value, label, Icon}) =>
        <button key={value} className="button" aria-pressed={service.theme === value} onClick={() => service.choose(value)}>
          <Icon size={18}/>{label}
        </button>
      )}
    </div>
    <p>System follows your device’s appearance. Your choice is remembered on this browser.</p>
    {service.error && <p role="status">{service.error}</p>}
  </section>;
}
