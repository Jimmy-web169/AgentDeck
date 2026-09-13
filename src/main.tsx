import { QueryClientProvider } from '@tanstack/react-query'
import { createQueryClient } from './api/index.ts'
import React from 'react'
import { createRoot } from 'react-dom/client'
// code-highlight colors live in index.css as theme-aware variables
// (a static stylesheet like github-dark.css would leak into the light theme)
import './index.css'
import App from './App.tsx'
import ErrorBoundary from './components/shared/ErrorBoundary.tsx'
import TerminalPopout from './components/shared/TerminalPopout.tsx'
import { MAIN_WINDOW_NAME, isPopoutHash } from './lib/route.ts'

const queryClient = createQueryClient()

const root = document.getElementById('root')
if (!root) throw new Error('Missing application root')
// A popped-out terminal is the same bundle showing one page; the main window
// takes a name so that page can bring it back to the front.
const popout = isPopoutHash(location.hash)
if (!popout) window.name = MAIN_WINDOW_NAME
createRoot(root).render(
  <React.StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>{popout ? <TerminalPopout /> : <App />}</QueryClientProvider>
    </ErrorBoundary>
  </React.StrictMode>
)
