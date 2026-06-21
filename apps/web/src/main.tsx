import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import App from './App';
import { AuthProvider } from './lib/auth';
import { queryClient } from './lib/query-client';
import './index.css';

window.addEventListener('error', (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;white-space:pre-wrap">${e.message}\n\n${e.filename}:${e.lineno}\n\n${e.error?.stack ?? ''}</pre>`;
});
window.addEventListener('unhandledrejection', (e) => {
  document.body.innerHTML = `<pre style="color:red;padding:20px;white-space:pre-wrap">Unhandled rejection:\n${String(e.reason)}\n\n${e.reason?.stack ?? ''}</pre>`;
});

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <App />
          <Toaster position="top-right" richColors />
        </AuthProvider>
      </QueryClientProvider>
    </BrowserRouter>
  </React.StrictMode>,
);
