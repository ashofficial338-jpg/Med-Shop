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
