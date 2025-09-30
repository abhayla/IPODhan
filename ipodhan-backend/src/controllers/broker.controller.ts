import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export class BrokerController {
  // Get all brokers
  async getAllBrokers(req: Request, res: Response) {
    try {
      const brokers = await prisma.broker.findMany({
        orderBy: { rating: 'desc' }
      })

      res.json({ success: true, data: brokers })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch brokers' })
    }
  }

  // Get single broker by ID
  async getBrokerById(req: Request, res: Response) {
    try {
      const { id } = req.params

      const broker = await prisma.broker.findUnique({
        where: { id }
      })

      if (!broker) {
        return res.status(404).json({ success: false, error: 'Broker not found' })
      }

      res.json({ success: true, data: broker })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch broker' })
    }
  }

  // Create new broker
  async createBroker(req: Request, res: Response) {
    try {
      const brokerData = req.body

      const broker = await prisma.broker.create({
        data: brokerData
      })

      res.status(201).json({ success: true, data: broker })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to create broker' })
    }
  }

  // Update broker
  async updateBroker(req: Request, res: Response) {
    try {
      const { id } = req.params
      const updateData = req.body

      const broker = await prisma.broker.update({
        where: { id },
        data: updateData
      })

      res.json({ success: true, data: broker })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to update broker' })
    }
  }

  // Delete broker
  async deleteBroker(req: Request, res: Response) {
    try {
      const { id } = req.params

      await prisma.broker.delete({
        where: { id }
      })

      res.json({ success: true, message: 'Broker deleted successfully' })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to delete broker' })
    }
  }
}