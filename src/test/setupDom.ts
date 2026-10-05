// Polyfill AnimationEvent for jsdom test environment so @testing-library/dom registers animationEnd
if (typeof window !== 'undefined' && !(window as unknown as { AnimationEvent?: unknown }).AnimationEvent) {
  class MockAnimationEvent extends Event {
    animationName: string
    constructor(type: string, init?: { animationName?: string; bubbles?: boolean; cancelable?: boolean }) {
      super(type, init)
      this.animationName = init?.animationName ?? ''
    }
  }
  Object.defineProperty(window, 'AnimationEvent', { value: MockAnimationEvent, writable: true, configurable: true })
  Object.defineProperty(globalThis, 'AnimationEvent', { value: MockAnimationEvent, writable: true, configurable: true })
}
