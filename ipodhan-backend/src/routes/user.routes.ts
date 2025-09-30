import { Router } from 'express'
import { UserController } from '../controllers/user.controller'
import { authenticate } from '../middleware/auth.middleware'

const router = Router()
const userController = new UserController()

// Auth routes
router.post('/register', userController.register)
router.post('/login', userController.login)
router.post('/logout', authenticate, userController.logout)
router.post('/refresh-token', userController.refreshToken)

// Profile routes
router.get('/profile', authenticate, userController.getProfile)
router.put('/profile', authenticate, userController.updateProfile)
router.delete('/account', authenticate, userController.deleteAccount)

// Password routes
router.post('/forgot-password', userController.forgotPassword)
router.post('/reset-password', userController.resetPassword)
router.put('/change-password', authenticate, userController.changePassword)

export default router