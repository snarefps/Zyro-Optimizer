import { Component, ReactNode } from 'react'
import { Icon } from './Icon'
import { Button } from './ui'

export class ErrorBoundary extends Component<{ children: ReactNode; resetKey?: string }, { error: Error | null }> {
  state = { error: null as Error | null }

  static getDerivedStateFromError(error: Error) {
    return { error }
  }

  componentDidUpdate(prev: { resetKey?: string }) {
    if (prev.resetKey !== this.props.resetKey && this.state.error) this.setState({ error: null })
  }

  render() {
    if (!this.state.error) return this.props.children
    return (
      <div className="flex flex-1 flex-col items-center justify-center text-center">
        <Icon name="error" size={64} className="mb-3 text-mute" />
        <div className="text-[20px] font-semibold">This page hit a problem</div>
        <div className="mt-1 max-w-md text-[14px] text-mute">{this.state.error.message}</div>
        <Button className="mt-5" onClick={() => this.setState({ error: null })}>Try again</Button>
      </div>
    )
  }
}
