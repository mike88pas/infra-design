import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { Gate } from './components/Gate'
import './index.css'

/** Brama dostępu przed właściwą aplikacją — App montuje się dopiero po odblokowaniu. */
function Root(): JSX.Element {
  const [unlocked, setUnlocked] = useState(false)
  return unlocked ? <App /> : <Gate onUnlocked={() => setUnlocked(true)} />
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>
)
