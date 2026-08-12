import i18n from 'i18next'
import { initReactI18next } from 'react-i18next'
import ar from './locales/ar.json'
import en from './locales/en.json'

// لغة المتصفح: عربي افتراضياً للمستخدمين العرب
const getBrowserLang = () => {
  const l = (navigator.language || 'ar').toLowerCase()
  return l.startsWith('ar') ? 'ar' : 'en'
}

const saved = (() => {
  try {
    return localStorage.getItem('voice-lang')
  } catch {
    return null
  }
})()

i18n.use(initReactI18next).init({
  resources: {
    ar: { translation: ar },
    en: { translation: en },
  },
  lng: saved || getBrowserLang(),
  fallbackLng: 'ar',
  interpolation: {
    escapeValue: false,
    prefix: '{',
    suffix: '}',
  },
})

// ضبط اتجاه الصفحة حسب اللغة (RTL للعربية / LTR للإنجليزية)
const TITLES = {
  ar: 'الصوت بين يديك | صوت ↔ نص محلي',
  en: 'Voice at your fingertips | Speech ↔ Text',
}
const applyDir = () => {
  const lng = i18n.language === 'ar' ? 'ar' : 'en'
  document.documentElement.dir = lng === 'ar' ? 'rtl' : 'ltr'
  document.documentElement.lang = lng
  document.title = TITLES[lng] || TITLES.ar
}
applyDir()
i18n.on('languageChanged', applyDir)

export const toggleLang = () => {
  const next = i18n.language === 'ar' ? 'en' : 'ar'
  i18n.changeLanguage(next)
  try {
    localStorage.setItem('voice-lang', next)
  } catch {
    /* ignore */
  }
}

/** ضبط لغة الواجهة يدوياً (ar/en) — تُحفظ في localStorage */
export const setLang = (lang) => {
  const next = lang === 'ar' ? 'ar' : 'en'
  i18n.changeLanguage(next)
  try {
    localStorage.setItem('voice-lang', next)
  } catch {
    /* ignore */
  }
}

export default i18n
