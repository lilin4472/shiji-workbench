import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from '../App'
import { seedTrialCases } from './seed'
import '../styles.css'
import '../project-lifecycle.css'

seedTrialCases()
createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)
