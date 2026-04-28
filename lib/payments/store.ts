import { promises as fs } from 'fs'
import path from 'path'

import { paymentConfig } from '@/lib/payments/config'
import type { PaymentOrder } from '@/lib/payments/types'

type StoreShape = {
  orders: PaymentOrder[]
}

const DEFAULT_STORE: StoreShape = { orders: [] }

let writeQueue = Promise.resolve()

function getStoragePath() {
  const fileName = path.basename(paymentConfig.storageFile)
  return path.join(process.cwd(), 'data', fileName)
}

async function ensureStoreFile() {
  const filePath = getStoragePath()
  await fs.mkdir(path.dirname(filePath), { recursive: true })

  try {
    await fs.access(filePath)
  } catch {
    await fs.writeFile(filePath, JSON.stringify(DEFAULT_STORE, null, 2), 'utf8')
  }

  return filePath
}

async function readStore(): Promise<StoreShape> {
  const filePath = await ensureStoreFile()
  const raw = await fs.readFile(filePath, 'utf8')

  if (!raw.trim()) {
    return DEFAULT_STORE
  }

  const parsed = JSON.parse(raw) as Partial<StoreShape>
  return {
    orders: Array.isArray(parsed.orders) ? parsed.orders : [],
  }
}

async function writeStore(store: StoreShape) {
  const filePath = await ensureStoreFile()
  await fs.writeFile(filePath, JSON.stringify(store, null, 2), 'utf8')
}

async function withWriteLock<T>(fn: () => Promise<T>) {
  const run = writeQueue.then(fn, fn)
  writeQueue = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

export async function listOrders() {
  const store = await readStore()
  return store.orders
}

export async function getOrder(invoiceId: string) {
  const orders = await listOrders()
  return orders.find((order) => order.invoiceId === invoiceId)
}

export async function createOrder(order: PaymentOrder) {
  return withWriteLock(async () => {
    const store = await readStore()
    store.orders.unshift(order)
    await writeStore(store)
    return order
  })
}

export async function updateOrder(
  invoiceId: string,
  updater: (order: PaymentOrder) => PaymentOrder,
) {
  return withWriteLock(async () => {
    const store = await readStore()
    const index = store.orders.findIndex((order) => order.invoiceId === invoiceId)

    if (index === -1) {
      return null
    }

    store.orders[index] = updater(store.orders[index])
    await writeStore(store)
    return store.orders[index]
  })
}
