import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export class IPOController {
  // Get all IPOs with pagination and filters
  async getAllIPOs(req: Request, res: Response) {
    try {
      const { page = 1, limit = 10, status, exchange, category } = req.query

      const skip = (Number(page) - 1) * Number(limit)

      const where: any = {}
      if (status) where.status = status
      if (exchange) where.exchange = exchange
      if (category) where.category = category

      const [ipos, total] = await Promise.all([
        prisma.iPO.findMany({
          where,
          skip,
          take: Number(limit),
          include: {
            gmpHistory: {
              orderBy: { recordedAt: 'desc' },
              take: 1
            },
            performance: true
          },
          orderBy: { openDate: 'desc' }
        }),
        prisma.iPO.count({ where })
      ])

      res.json({
        success: true,
        data: ipos,
        pagination: {
          page: Number(page),
          limit: Number(limit),
          total,
          pages: Math.ceil(total / Number(limit))
        }
      })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch IPOs' })
    }
  }

  // Get single IPO by ID
  async getIPOById(req: Request, res: Response) {
    try {
      const { id } = req.params

      const ipo = await prisma.iPO.findUnique({
        where: { id },
        include: {
          gmpHistory: {
            orderBy: { recordedAt: 'desc' },
            take: 10
          },
          performance: true,
          applications: {
            select: {
              id: true,
              status: true,
              quantity: true
            }
          }
        }
      })

      if (!ipo) {
        return res.status(404).json({ success: false, error: 'IPO not found' })
      }

      res.json({ success: true, data: ipo })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch IPO' })
    }
  }

  // Get IPOs by status
  async getIPOsByStatus(req: Request, res: Response) {
    try {
      const { status } = req.params

      const ipos = await prisma.iPO.findMany({
        where: {
          status: status.toUpperCase() as any
        },
        include: {
          gmpHistory: {
            orderBy: { recordedAt: 'desc' },
            take: 1
          }
        },
        orderBy: { openDate: 'desc' }
      })

      res.json({ success: true, data: ipos })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch IPOs' })
    }
  }

  // Create new IPO (Admin only)
  async createIPO(req: Request, res: Response) {
    try {
      const ipoData = req.body

      const ipo = await prisma.iPO.create({
        data: ipoData
      })

      res.status(201).json({ success: true, data: ipo })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to create IPO' })
    }
  }

  // Update IPO
  async updateIPO(req: Request, res: Response) {
    try {
      const { id } = req.params
      const updateData = req.body

      const ipo = await prisma.iPO.update({
        where: { id },
        data: updateData
      })

      res.json({ success: true, data: ipo })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to update IPO' })
    }
  }

  // Update subscription data
  async updateSubscription(req: Request, res: Response) {
    try {
      const { id } = req.params
      const { subscription, retailSub, qibSub, niiSub } = req.body

      const ipo = await prisma.iPO.update({
        where: { id },
        data: {
          subscription,
          retailSub,
          qibSub,
          niiSub
        }
      })

      res.json({ success: true, data: ipo })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to update subscription' })
    }
  }

  // Delete IPO (Admin only)
  async deleteIPO(req: Request, res: Response) {
    try {
      const { id } = req.params

      await prisma.iPO.delete({
        where: { id }
      })

      res.json({ success: true, message: 'IPO deleted successfully' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to delete IPO' })
    }
  }
}