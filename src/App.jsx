import { useState } from 'react'
import AdminPanel from './components/AdminPanel'
import UserPanel from './components/UserPanel'
import './App.css'

const getInitialPanel = () =>
  new URLSearchParams(window.location.search).get('panel') === 'user' ? 'user' : 'admin'

function App() {
  const [activePanel, setActivePanel] = useState(getInitialPanel)

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
