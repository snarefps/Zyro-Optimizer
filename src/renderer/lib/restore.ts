import { zy } from '../api'
import { runTask } from './tasks'

// Creates a Windows restore point on request and shows it in the Action Center. Throws if Windows says no.
export async function createRestorePoint(page: string): Promise<void> {
  await runTask({ title: 'Creating a restore point', icon: 'restore-page', page, message: 'Asking Windows to create a restore point...' }, async (h) => {
    const r = await zy.system.createRestorePoint()
    if (!r.created) throw new Error(r.reason ?? 'Failed')
    h.done('Windows restore point created')
  })
}
