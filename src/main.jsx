import React from 'react'
import { createRoot } from 'react-dom/client'
import 'highlight.js/styles/github-dark.css'
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
