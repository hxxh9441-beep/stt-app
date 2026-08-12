import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './i18n'
import App from './App.jsx'
import { registerSW } from 'virtual:pwa-register'

// تسجيل Service Worker — يتيح العمل أوفلاين بالكامل بعد الزيارة الأولى
registerSW({ immediate: true })

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
