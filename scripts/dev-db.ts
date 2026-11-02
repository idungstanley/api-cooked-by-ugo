import { mkdirSync } from 'node:fs'
import { MongoMemoryServer } from 'mongodb-memory-server'

/** Local MongoDB with no install needed. Data persists in `.mongo-data`. */
const dbPath = '.mongo-data'
mkdirSync(dbPath, { recursive: true })

const server = await MongoMemoryServer.create({
  instance: { port: 27017, dbPath, storageEngine: 'wiredTiger' },
})

console.log(`MongoDB ready at ${server.getUri()}`)

const stop = async () => {
  await server.stop({ doCleanup: false })
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
