import { createRoot } from 'react-dom/client';
import App from './App';
import { hydrateSettings } from './settingsStore';
import './styles.css';
import './next.css';
import './refinements.css';
import './ux.css';
import './codeTabs.css';
import './polish.css';
import './dataPreferences.css';
import './formattingPreview.css';

await hydrateSettings();
createRoot(document.getElementById('root')!).render(<App />);
