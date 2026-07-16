import React from 'react'
import { createRoot } from 'react-dom/client'
// code-highlight colors live in index.css as theme-aware variables
// (a static stylesheet like github-dark.css would leak into the light theme)
import './index.css'
import App from './App.jsx'
import ErrorBoundary from './components/shared/ErrorBoundary.jsx'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </React.StrictMode>
)
