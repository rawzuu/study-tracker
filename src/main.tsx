import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { StoreProvider } from './data/store';
import { TimerProvider } from './features/timer/TimerContext';
import { ToastProvider } from './components/ui';
import { App } from './App';
import './styles/global.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StoreProvider>
      <TimerProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </TimerProvider>
    </StoreProvider>
  </StrictMode>,
);

// Service worker pro offline režim a instalaci na plochu (jen v produkci)
if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register(`${import.meta.env.BASE_URL}sw.js`).catch(() => {});
  });
}
