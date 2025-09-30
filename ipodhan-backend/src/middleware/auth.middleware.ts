import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'

export const authenticate = (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, error: 'No token provided' })
    }

    const token = authHeader.substring(7)

    const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any
    (req as any).userId = decoded.userId
    (req as any).userEmail = decoded.email

    next()
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Invalid or expired token' })
  }
}

export const authorizeAdmin = (req: Request, res: Response, next: NextFunction) => {
  // Implementation for admin authorization
  // Check if user role is ADMIN
  next()
}