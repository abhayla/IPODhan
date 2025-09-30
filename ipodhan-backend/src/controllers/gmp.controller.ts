import { Request, Response } from 'express'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()

export class GMPController {
  // Get latest GMP for all active IPOs
  async getLatestGMP(req: Request, res: Response) {
    try {
      const latestGMPs = await prisma.gMP.findMany({
        distinct: ['ipoId'],
        orderBy: { recordedAt: 'desc' },
        include: {
          ipo: {
            select: {
              id: true,
              companyName: true,
              symbol: true,
              status: true,
              priceRangeLow: true,
              priceRangeHigh: true
            }
          }
        }
      })

      res.json({ success: true, data: latestGMPs })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch GMP data' })
    }
  }

  // Get GMP history for specific IPO
  async getGMPHistory(req: Request, res: Response) {
    try {
      const { ipoId } = req.params
      const { limit = 30 } = req.query

      const gmpHistory = await prisma.gMP.findMany({
        where: { ipoId },
        orderBy: { recordedAt: 'desc' },
        take: Number(limit),
        include: {
          ipo: {
            select: {
              companyName: true,
              priceRangeLow: true,
              priceRangeHigh: true
            }
          }
        }
      })

      res.json({ success: true, data: gmpHistory })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to fetch GMP history' })
    }
  }

  // Add new GMP record
  async addGMPRecord(req: Request, res: Response) {
    try {
      const { ipoId, premium, source } = req.body

      // Get IPO details
      const ipo = await prisma.iPO.findUnique({
        where: { id: ipoId }
      })

      if (!ipo) {
        return res.status(404).json({ success: false, error: 'IPO not found' })
      }

      // Calculate percentage and expected listing
      const avgPrice = (ipo.priceRangeLow + ipo.priceRangeHigh) / 2
      const premiumPercent = (premium / avgPrice) * 100
      const expectedListing = avgPrice + premium

      const gmpRecord = await prisma.gMP.create({
        data: {
          ipoId,
          premium,
          premiumPercent,
          expectedListing,
          source
        }
      })

      res.status(201).json({ success: true, data: gmpRecord })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to add GMP record' })
    }
  }

  // Update GMP record
  async updateGMPRecord(req: Request, res: Response) {
    try {
      const { id } = req.params
      const updateData = req.body

      const gmpRecord = await prisma.gMP.update({
        where: { id },
        data: updateData
      })

      res.json({ success: true, data: gmpRecord })
    } catch (error) {
      res.status(500).json({ success: false, error: 'Failed to update GMP record' })
    }
  }
}