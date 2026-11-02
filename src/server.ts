import { createServer } from 'node:http'
import mongoose from 'mongoose'
import { createApp } from './app.js'
import { env } from './config/env.js'
import { startJobs } from './services/jobs.js'
import { startRealtime } from './services/realtime.js'

await mongoose.connect(env.MONGODB_URI)

const server = createServer(createApp())
startRealtime(server)
const jobs = startJobs()

server.listen(env.PORT, () => console.log(`API running on port ${env.PORT}`))

const stop = () => {
  clearInterval(jobs)
  server.close(() => void mongoose.disconnect().then(() => process.exit(0)))
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
