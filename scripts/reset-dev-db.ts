import mongoose from 'mongoose'

/** Wipes the local database. Run `npm run seed` afterwards. Never points at a live database. */
const uri = process.env.MONGODB_URI ?? ''
if (process.env.NODE_ENV === 'production' || !/(127\.0\.0\.1|localhost)/.test(uri)) {
  throw new Error('Refusing to reset anything except a local database')
}
await mongoose.connect(uri)
await mongoose.connection.dropDatabase()
await mongoose.disconnect()
console.log('Local database reset')
