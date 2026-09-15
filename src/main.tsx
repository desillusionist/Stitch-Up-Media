import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import { EditJobApp } from './components/EditJobApp'
import './styles/design-tokens.css'
import './index.css'

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    {window.location.hash === '#edit-job' ? <EditJobApp /> : <App />}
  </React.StrictMode>,
)
