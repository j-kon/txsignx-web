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

  const handleLogoClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (window.location.hash === '#home' || page === '#home') {
      e.preventDefault()
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
    } else {
      window.location.hash = '#home'
    }
  }

  const handleNavClick = (targetHash: string) => (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (window.location.hash === targetHash || page === targetHash) {
      e.preventDefault()
      const prefersReducedMotion =
        typeof window !== 'undefined' &&
        window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches
      window.scrollTo({ top: 0, behavior: prefersReducedMotion ? 'auto' : 'smooth' })
    } else {
      window.location.hash = targetHash
    }
  }

  return (
    <header className={`site-header ${scrolled?'scrolled':''}`}>
      <div className="header-inner">
        <a
          className="wordmark"
          href="#home"
          aria-label="TxSignX Home"
          onClick={handleLogoClick}
        >
          <span className="wordmark-icon" aria-hidden="true">
            <svg viewBox="0 0 32 32" width="22" height="22" fill="none" xmlns="http://www.w3.org/2000/svg">
              <polygon points="16,3 29,10.5 29,21.5 16,29 3,21.5 3,10.5" stroke="#243041" strokeWidth="2" fill="#111827"/>
              <path d="M11 11L21 21M21 11L11 21" stroke="#F7931A" strokeWidth="2.5" strokeLinecap="round"/>
            </svg>
          </span>
          TxSign<span className="logo-accent">X</span>
        </a>
        <nav aria-label="Main navigation">
          <a href="#home" aria-current={page === '#home' ? 'page' : undefined} onClick={handleNavClick('#home')}>Overview</a>
          <a
            href="#live"
            aria-current={page === '#live' ? 'page' : undefined}
            onClick={handleNavClick('#live')}
          >
            Live Chain
          </a>
          <a
            href="#inspector"
            aria-current={page === '#inspector' ? 'page' : undefined}
            onClick={handleNavClick('#inspector')}
          >
            Inspector
          </a>
          <a
            href="#policies"
            aria-current={page === '#policies' ? 'page' : undefined}
            onClick={handleNavClick('#policies')}
          >
            Policies
          </a>
          <a className="nav-external" href="https://github.com/j-kon/txsignx" target="_blank" rel="noreferrer">
            GitHub
          </a>
        </nav>
        <span className="development" title="Under active development">Development preview</span>
      </div>
    </header>
  )
}
