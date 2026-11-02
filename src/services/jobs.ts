import { expireUnpaidOrders, sendScheduledReminders } from '../modules/orders/orders.service.js'

const JOB_INTERVAL_MS = 5 * 60_000

export const startJobs = () => {
  const run = () =>
    Promise.all([expireUnpaidOrders(), sendScheduledReminders()]).catch((error) =>
      console.error('Scheduled job failed', error),
    )
  void run()
  return setInterval(run, JOB_INTERVAL_MS)
}
