import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import { Web3Provider } from './context/Web3Provider.jsx'
import { ErrorBoundary } from './components/ErrorBoundary.jsx'
import { ToastProvider } from './context/ToastContext.jsx'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <ErrorBoundary>
      <Web3Provider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </Web3Provider>
    </ErrorBoundary>
  </StrictMode>,
)
