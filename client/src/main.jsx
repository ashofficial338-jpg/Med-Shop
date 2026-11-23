import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { ToastContainer } from 'react-toastify'
import 'react-toastify/dist/ReactToastify.css'
import './index.css'
import App from './App.jsx'
import { AuthProvider } from './context/AuthContext.jsx'
import { CartProvider } from './context/CartContext.jsx'
import { LiveSyncProvider } from './context/LiveSync.jsx'
import { installFx } from './utils/fx.js'

installFx()

// Pages load on demand. After a new deploy, a tab that was already open asks
// for page files that no longer exist - reload once to pick up the new
// version instead of showing a blank page. (Guarded so it can't loop.)
window.addEventListener('vite:preloadError', (event) => {
  let last = 0
  try { last = Number(sessionStorage.getItem('ghm-chunk-reload')) || 0 } catch { /* storage blocked */ }
  if (Date.now() - last < 10_000) return
  try { sessionStorage.setItem('ghm-chunk-reload', String(Date.now())) } catch { /* storage blocked */ }
  event.preventDefault()
  window.location.reload()
})

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <LiveSyncProvider>
        <CartProvider>
          <App />
          <ToastContainer position="top-right" autoClose={3000} newestOnTop pauseOnFocusLoss={false} />
        </CartProvider>
        </LiveSyncProvider>
      </AuthProvider>
    </BrowserRouter>
  </StrictMode>,
)
