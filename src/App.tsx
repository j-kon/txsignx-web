import {useEffect,useState} from 'react'
import {ApiClient} from './lib/api/client'
import {Header} from './components/Header'
import {Home} from './pages/Home'
import {Inspector} from './features/Inspector'
import {Policies} from './features/Policies'

function App(){
  const [page,setPage]=useState(()=>window.location.hash)
  const [connection]=useState(()=>{
    try{
      return {api:new ApiClient(),error:''}
    }catch{
      return {
        api:null,
        error:'Invalid API URL configuration. Set VITE_TXSIGNX_API_URL to an HTTP(S) API base URL without credentials, query or fragment.'
      }
    }
  })

  useEffect(()=>{
    const change=()=>setPage(window.location.hash)
    window.addEventListener('hashchange',change)
    return ()=>window.removeEventListener('hashchange',change)
  },[])

  return (
    <>
      <a className="skip-link" href="#main">Skip to content</a>
      <Header page={page} />
      <main id="main">
        {connection.error?(
          <div className="connection-error" role="alert">
            <p>{connection.error}</p>
          </div>
        ):page==='#inspector'?(
          <Inspector api={connection.api!}/>
        ):page==='#policies'?(
          <Policies api={connection.api!}/>
        ):(
          <Home/>
        )}
      </main>
      <footer className="site-footer">
        <div className="footer-inner">
          <div className="footer-brand">
            <span className="footer-title">TxSignX — Inspect. Verify. Sign with Confidence.</span>
            <p className="footer-desc">A deterministic open-source pre-sign security layer for Bitcoin transactions and PSBTs.</p>
          </div>
          <div className="footer-meta">
            <span>Open source. Not audited or production-ready.</span>
            <span className="footer-links">
              <a href="https://github.com/j-kon/txsignx" target="_blank" rel="noreferrer">GitHub</a> ·{' '}
              <a href="https://github.com/j-kon/txsignx-docs" target="_blank" rel="noreferrer">Documentation</a>
            </span>
          </div>
        </div>
      </footer>
    </>
  )
}

export default App
