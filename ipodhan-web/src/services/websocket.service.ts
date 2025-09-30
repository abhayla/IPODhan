class WebSocketService {
  private ws: WebSocket | null = null
  private reconnectInterval = 5000
  private shouldReconnect = true
  private listeners: Map<string, Set<Function>> = new Map()

  connect(url: string = 'ws://localhost:5000') {
    if (this.ws?.readyState === WebSocket.OPEN) {
      return
    }

    this.ws = new WebSocket(url)

    this.ws.onopen = () => {
      console.log('WebSocket connected')
      this.emit('connected')
    }

    this.ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        this.handleMessage(data)
      } catch (error) {
        console.error('Failed to parse WebSocket message:', error)
      }
    }

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      this.emit('error', error)
    }

    this.ws.onclose = () => {
      console.log('WebSocket disconnected')
      this.emit('disconnected')

      if (this.shouldReconnect) {
        setTimeout(() => this.connect(url), this.reconnectInterval)
      }
    }
  }

  disconnect() {
    this.shouldReconnect = false
    if (this.ws) {
      this.ws.close()
      this.ws = null
    }
  }

  send(type: string, data: any) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type, data }))
    } else {
      console.warn('WebSocket is not connected')
    }
  }

  on(event: string, callback: Function) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set())
    }
    this.listeners.get(event)?.add(callback)
  }

  off(event: string, callback: Function) {
    this.listeners.get(event)?.delete(callback)
  }

  private emit(event: string, data?: any) {
    this.listeners.get(event)?.forEach(callback => callback(data))
  }

  private handleMessage(message: any) {
    switch (message.type) {
      case 'ipo_update':
        this.emit('ipo_update', message.data)
        break
      case 'gmp_update':
        this.emit('gmp_update', message.data)
        break
      case 'subscription_update':
        this.emit('subscription_update', message.data)
        break
      case 'allotment_status':
        this.emit('allotment_status', message.data)
        break
      default:
        this.emit('message', message)
    }
  }

  // Subscribe to specific IPO updates
  subscribeToIPO(ipoId: string) {
    this.send('subscribe_ipo', { ipoId })
  }

  unsubscribeFromIPO(ipoId: string) {
    this.send('unsubscribe_ipo', { ipoId })
  }

  // Subscribe to GMP updates
  subscribeToGMP() {
    this.send('subscribe_gmp', {})
  }

  unsubscribeFromGMP() {
    this.send('unsubscribe_gmp', {})
  }
}

export default new WebSocketService()