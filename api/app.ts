import express, {
  type Request,
  type Response,
  type NextFunction,
} from 'express'
import cors from 'cors'
import path from 'path'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import './db'

import studentRoutes from './routes/students'
import importRoutes from './routes/import'
import anomalyRoutes from './routes/anomalies'
import ruleRoutes from './routes/rules'
import exportRoutes from './routes/export'
import statisticsRoutes from './routes/statistics'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

dotenv.config()

const app: express.Application = express()

app.use(cors())
app.use(express.json({ limit: '20mb' }))
app.use(express.urlencoded({ extended: true, limit: '20mb' }))

app.use('/api/students', studentRoutes)
app.use('/api/import', importRoutes)
app.use('/api/anomalies', anomalyRoutes)
app.use('/api/rules', ruleRoutes)
app.use('/api/export', exportRoutes)
app.use('/api/statistics', statisticsRoutes)

app.use(
  '/api/health',
  (req: Request, res: Response, next: NextFunction): void => {
    res.status(200).json({
      success: true,
      message: 'ok',
    })
  },
)

app.use((error: Error, req: Request, res: Response, next: NextFunction) => {
  console.error(error)
  res.status(500).json({
    success: false,
    error: error.message || 'Server internal error',
  })
})

app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    error: 'API not found',
  })
})

export default app
