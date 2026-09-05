import { useState } from 'react'
import AdminPanel from './components/AdminPanel'
import LocationTracker from './components/LocationTracker'
import UserPanel from './components/UserPanel'
import './App.css'

const getInitialPanel = () => {
  const requestedPanel = new URLSearchParams(window.location.search).get('panel')
  if (requestedPanel === 'user' || requestedPanel === 'tracker') {
    return requestedPanel
  }
  return 'admin'
}

function App() {
  const [activePanel, setActivePanel] = useState(getInitialPanel)

  if (activePanel === 'tracker') {
    return (
      <div className="app-shell">
        <LocationTracker />
      </div>
    )
  }

  return (
    <div className="app-shell">
      <div className="panel-switcher" role="tablist" aria-label="Application panel">
        <button
          aria-selected={activePanel === 'admin'}
          className={activePanel === 'admin' ? 'active' : ''}
          onClick={() => setActivePanel('admin')}
          role="tab"
          type="button"
        >
          Admin Panel
        </button>
        <button
          aria-selected={activePanel === 'user'}
          className={activePanel === 'user' ? 'active' : ''}
          onClick={() => setActivePanel('user')}
          role="tab"
          type="button"
        >
          User Panel
        </button>
      </div>
      {activePanel === 'admin' ? <AdminPanel /> : <UserPanel />}
    </div>
  )
}

export default App
