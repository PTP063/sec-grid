import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ErrorOverlay } from './components/ui/ErrorOverlay.tsx'
import { useErrorStore } from './store/useErrorStore.ts'
import { registerSW } from 'virtual:pwa-register'

registerSW({ immediate: true })

// Capture global asynchronous errors and promise rejections
window.addEventListener('unhandledrejection', (event) => {
  useErrorStore.getState().addError(event.reason || new Error('Unhandled Promise Rejection'));
});

window.addEventListener('error', (event) => {
  if (event.message?.includes('ResizeObserver loop')) {
    return; // Ignore benign ReactFlow/D3 resize observer errors
  }
  useErrorStore.getState().addError(event.error || new Error(event.message));
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
      <ErrorOverlay />
    </ErrorBoundary>
  </StrictMode>,
)
