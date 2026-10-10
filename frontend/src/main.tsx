import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)

// Reikalingas, kad appsą būtų galima įsidėti į telefono ekraną.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // Neįsiregistravęs service worker'is nieko nelaužo — tik nebus įdiegiamas.
    })
  })
}
