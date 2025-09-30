import { Router } from 'express'
import { IPOController } from '../controllers/ipo.controller'

const router = Router()
const ipoController = new IPOController()

// Get all IPOs with filters
router.get('/', ipoController.getAllIPOs)

// Get single IPO by ID
router.get('/:id', ipoController.getIPOById)

// Get IPOs by status
router.get('/status/:status', ipoController.getIPOsByStatus)

// Create new IPO (Admin only)
router.post('/', ipoController.createIPO)

// Update IPO (Admin only)
router.put('/:id', ipoController.updateIPO)

// Update subscription data
router.patch('/:id/subscription', ipoController.updateSubscription)

// Delete IPO (Admin only)
router.delete('/:id', ipoController.deleteIPO)

export default router