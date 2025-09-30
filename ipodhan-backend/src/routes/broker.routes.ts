import { Router } from 'express'
import { BrokerController } from '../controllers/broker.controller'

const router = Router()
const brokerController = new BrokerController()

// Get all brokers
router.get('/', brokerController.getAllBrokers)

// Get single broker
router.get('/:id', brokerController.getBrokerById)

// Create broker (Admin only)
router.post('/', brokerController.createBroker)

// Update broker (Admin only)
router.put('/:id', brokerController.updateBroker)

// Delete broker (Admin only)
router.delete('/:id', brokerController.deleteBroker)

export default router