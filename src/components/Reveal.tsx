import {useEffect,useRef,useState} from 'react'
import type {ReactNode} from 'react'

interface RevealProps {
  children: ReactNode
  className?: string
  delay?: number
}

function checkImmediate():boolean {
  if (typeof window==='undefined'||!('IntersectionObserver' in window)) return true
  if (typeof window.matchMedia==='function'&&window.matchMedia('(prefers-reduced-motion: reduce)').matches) return true
  return false
}

export function Reveal({children,className='',delay=0}:RevealProps){
  const ref=useRef<HTMLDivElement>(null)
  const [isVisible,setIsVisible]=useState(checkImmediate)

  useEffect(()=>{
    if (isVisible) return

    const element=ref.current
    if (!element) return

    const observer=new IntersectionObserver(
      ([entry])=>{
        if (entry.isIntersecting){
          setIsVisible(true)
          observer.unobserve(entry.target)
        }
      },
      {threshold:0.1,rootMargin:'0px 0px -40px 0px'}
    )

    observer.observe(element)
    return ()=>observer.disconnect()
  },[isVisible])

  return (
    <div
      ref={ref}
      className={`reveal-wrapper ${isVisible?'revealed':''} ${className}`}
      style={delay?{transitionDelay:`${delay}ms`}:undefined}
    >
      {children}
    </div>
  )
}
