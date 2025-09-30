const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api'

class ApiService {
  private async request<T>(endpoint: string, options?: RequestInit): Promise<T> {
    const token = localStorage.getItem('token')

    const config: RequestInit = {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...(token && { Authorization: `Bearer ${token}` }),
        ...options?.headers,
      },
    }

    const response = await fetch(`${API_BASE_URL}${endpoint}`, config)

    if (!response.ok) {
      throw new Error(`API Error: ${response.statusText}`)
    }

    return response.json()
  }

  // IPO Methods
  async getIPOs(params?: any) {
    const queryString = new URLSearchParams(params).toString()
    return this.request(`/ipos${queryString ? `?${queryString}` : ''}`)
  }

  async getIPOById(id: string) {
    return this.request(`/ipos/${id}`)
  }

  async getIPOsByStatus(status: string) {
    return this.request(`/ipos/status/${status}`)
  }

  // GMP Methods
  async getLatestGMP() {
    return this.request('/gmp/latest')
  }

  async getGMPHistory(ipoId: string, limit = 30) {
    return this.request(`/gmp/history/${ipoId}?limit=${limit}`)
  }

  // User Methods
  async register(data: any) {
    return this.request('/users/register', {
      method: 'POST',
      body: JSON.stringify(data),
    })
  }

  async login(email: string, password: string) {
    return this.request('/users/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  }

  async getProfile() {
    return this.request('/users/profile')
  }

  async updateProfile(data: any) {
    return this.request('/users/profile', {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  }

  // Broker Methods
  async getBrokers() {
    return this.request('/brokers')
  }

  async getBrokerById(id: string) {
    return this.request(`/brokers/${id}`)
  }
}

export default new ApiService()