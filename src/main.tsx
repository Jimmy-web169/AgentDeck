import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './api/index.ts'
import React from 'react'
import { createRoot } from 'react-dom/client'
// code-highlight colors live in index.css as theme-aware variables
// (a static stylesheet like github-dark.css would leak into the light theme)
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/shared/ErrorBoundary.tsx'

const queryClient = createQueryClient()

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
