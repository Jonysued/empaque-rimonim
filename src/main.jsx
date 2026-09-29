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

ReactDOM.createRoot(document.getElementById('root')).render(
  <App />
)
