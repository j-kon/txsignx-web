import {useEffect,useState} from 'react'

interface HeaderProps {
  page: string
}

export function Header({page}:HeaderProps){
  const [scrolled,setScrolled]=useState(false)

  useEffect(()=>{
    const onScroll=()=>{
      setScrolled(window.scrollY>15)
    }
    window.addEventListener('scroll',onScroll,{passive:true})
    onScroll()
    return ()=>window.removeEventListener('scroll',onScroll)
  },[])

  return (
    <header className={`site-header ${scrolled?'scrolled':''}`}>
      <div className="header-inner">
        <a className="wordmark" href="#home" aria-label="TxSignX Home">
          <span className="wordmark-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="16,3 29,10.5 29,21.5 16,29 3,21.5 3,10.5" stroke="#243041" strokeWidth="2" fill="#111827"/>
              <path d="M11 11L21 21M21 11L11 21" stroke="#F7931A" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </span>
          TxSign<span className="logo-accent">X</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#inspector" aria-current={page==='#inspector'?'page':undefined}>
            Inspector
          </a>
          <a href="#policies" aria-current={page==='#policies'?'page':undefined}>
            Policy rules
          </a>
          <a href="https://github.com/j-kon/txsignx" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <span className="development" title="Under active development">Development preview</span>
      </div>
    </header>
  )
}
