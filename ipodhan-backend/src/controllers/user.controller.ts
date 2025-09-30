import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'

const prisma = new PrismaClient()

export class UserController {
  // Register new user
  async register(req: Request, res: Response) {
    try {
      const { email, password, name, phone } = req.body

      // Check if user exists
      const existingUser = await prisma.user.findUnique({
        where: { email }
      })

      if (existingUser) {
        return res.status(400).json({ success: false, error: 'Email already registered' })
      }

      // Hash password
      const hashedPassword = await bcrypt.hash(password, 10)

      // Create user
      const user = await prisma.user.create({
        data: {
          email,
          password: hashedPassword,
          name,
          phone
        },
        select: {
          id: true,
          email: true,
          name: true,
          role: true
        }
      })

      // Generate token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      )

      res.status(201).json({
        success: true,
        data: { user, token }
      })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Registration failed' })
    }
  }

  // Login user
  async login(req: Request, res: Response) {
    try {
      const { email, password } = req.body

      // Find user
      const user = await prisma.user.findUnique({
        where: { email }
      })

      if (!user) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' })
      }

      // Check password
      const isPasswordValid = await bcrypt.compare(password, user.password)

      if (!isPasswordValid) {
        return res.status(401).json({ success: false, error: 'Invalid credentials' })
      }

      // Generate token
      const token = jwt.sign(
        { userId: user.id, email: user.email },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      )

      res.json({
        success: true,
        data: {
          user: {
            id: user.id,
            email: user.email,
            name: user.name,
            role: user.role
          },
          token
        }
      })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Login failed' })
    }
  }

  // Get user profile
  async getProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).userId

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true,
          isVerified: true,
          createdAt: true,
          portfolios: {
            orderBy: { createdAt: 'desc' },
            take: 5
          },
          applications: {
            orderBy: { appliedAt: 'desc' },
            take: 5
          }
        }
      })

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      res.json({ success: true, data: user })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch profile' })
    }
  }

  // Update profile
  async updateProfile(req: Request, res: Response) {
    try {
      const userId = (req as any).userId
      const { name, phone } = req.body

      const user = await prisma.user.update({
        where: { id: userId },
        data: { name, phone },
        select: {
          id: true,
          email: true,
          name: true,
          phone: true,
          role: true
        }
      })

      res.json({ success: true, data: user })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to update profile' })
    }
  }

  // Logout
  async logout(req: Request, res: Response) {
    res.json({ success: true, message: 'Logged out successfully' })
  }

  // Refresh token
  async refreshToken(req: Request, res: Response) {
    try {
      const { token } = req.body

      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
      const newToken = jwt.sign(
        { userId: decoded.userId, email: decoded.email },
        process.env.JWT_SECRET!,
        { expiresIn: process.env.JWT_EXPIRE || '7d' }
      )

      res.json({ success: true, data: { token: newToken } })
    } catch (error) {
      res.status(401).json({ success: false, error: 'Invalid token' })
    }
  }

  // Forgot password
  async forgotPassword(req: Request, res: Response) {
    // Implementation for sending reset email
    res.json({ success: true, message: 'Password reset email sent' })
  }

  // Reset password
  async resetPassword(req: Request, res: Response) {
    // Implementation for resetting password
    res.json({ success: true, message: 'Password reset successfully' })
  }

  // Change password
  async changePassword(req: Request, res: Response) {
    try {
      const userId = (req as any).userId
      const { currentPassword, newPassword } = req.body

      const user = await prisma.user.findUnique({
        where: { id: userId }
      })

      if (!user) {
        return res.status(404).json({ success: false, error: 'User not found' })
      }

      const isPasswordValid = await bcrypt.compare(currentPassword, user.password)

      if (!isPasswordValid) {
        return res.status(401).json({ success: false, error: 'Current password is incorrect' })
      }

      const hashedPassword = await bcrypt.hash(newPassword, 10)

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword }
      })

      res.json({ success: true, message: 'Password changed successfully' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to change password' })
    }
  }

  // Delete account
  async deleteAccount(req: Request, res: Response) {
    try {
      const userId = (req as any).userId

      await prisma.user.delete({
        where: { id: userId }
      })

      res.json({ success: true, message: 'Account deleted successfully' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to delete account' })
    }
  }
}