import { Router } from 'express'
import { GMPController } from '../controllers/gmp.controller'

const router = Router()
const gmpController = new GMPController()

// Get latest GMP for all IPOs
router.get('/latest', gmpController.getLatestGMP)

// Get GMP history for specific IPO
router.get('/history/:ipoId', gmpController.getGMPHistory)

// Add new GMP record (Admin only)
router.post('/', gmpController.addGMPRecord)

// Update GMP record (Admin only)
router.put('/:id', gmpController.updateGMPRecord)

export default router