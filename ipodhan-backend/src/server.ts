import express, { Application } from 'express'
import cors from 'cors'
import helmet from 'helmet'
import morgan from 'morgan'
import dotenv from 'dotenv'

// Import configuration
import logger from './config/logger'
import { errorHandler } from './middleware/errorHandler'

// Import routes
import ipoRoutes from './routes/ipo.routes'
import userRoutes from './routes/user.routes'
import gmpRoutes from './routes/gmp.routes'
import brokerRoutes from './routes/broker.routes'

// Load environment variables
dotenv.config()

const app: Application = express()
const PORT = process.env.PORT || 4000

// CORS Configuration
const corsOptions = {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || ['http://localhost:3000'],
  credentials: true,
  optionsSuccessStatus: 200
}

// Middleware
app.use(helmet())
app.use(cors(corsOptions))
app.use(express.json({ limit: '10mb' }))
app.use(express.urlencoded({ extended: true, limit: '10mb' }))
app.use(morgan('combined', {
  stream: { write: (message) => logger.info(message.trim()) }
}))

// Routes
app.use('/api/ipos', ipoRoutes)
app.use('/api/users', userRoutes)
app.use('/api/gmp', gmpRoutes)
app.use('/api/brokers', brokerRoutes)

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'OK', message: 'IPODhan API is running' })
})

// Error handling middleware
app.use(errorHandler)

// Start server
app.listen(PORT, () => {
  logger.info(`🚀 Server is running on port ${PORT}`)
  logger.info(`📍 Health check: http://localhost:${PORT}/health`)
  logger.info(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`)
})