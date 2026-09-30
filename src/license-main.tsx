import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import LicenseActivation from './components/LicenseActivation'
import './license.css'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <LicenseActivation />
  </StrictMode>,
)
