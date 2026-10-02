import React from 'react'
import ReactDOM from 'react-dom/client'
import { Capacitor } from '@capacitor/core'
import App from '@/App.jsx'
import '@/index.css'

if (Capacitor.getPlatform() === 'ios') {
  document.documentElement.classList.add('capacitor-ios')
  document.querySelector('meta[name="viewport"]')?.setAttribute(
    'content',
    'width=device-width, initial-scale=1.0, viewport-fit=cover'
  )
}

const updateViewport = () => {
  const viewport = window.visualViewport;
  document.documentElement.style.setProperty('--app-viewport-height', `${viewport?.height || window.innerHeight}px`);
  document.documentElement.style.setProperty('--app-viewport-top', `${viewport?.offsetTop || 0}px`);
};
updateViewport();
window.visualViewport?.addEventListener('resize', updateViewport);
window.visualViewport?.addEventListener('scroll', updateViewport, { passive: true });
window.addEventListener('resize', updateViewport);

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
