import { promises as fs } from 'fs'
import path from 'path'

import { paymentConfig } from '@/lib/payments/config'
import type { PaymentOrder, SavedCardToken } from '@/lib/payments/types'

type StoreShape = {
  orders: PaymentOrder[]
  tokens: SavedCardToken[]
}

const DEFAULT_STORE: StoreShape = { orders: [], tokens: [] }

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
    tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
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

export async function listOrdersFile() {
  const store = await readStore()
  return store.orders
}

export async function getOrderFile(invoiceId: string) {
  const orders = await listOrdersFile()
  return orders.find((order) => order.invoiceId === invoiceId)
}

export async function createOrderFile(order: PaymentOrder) {
  return withWriteLock(async () => {
    const store = await readStore()
    store.orders.unshift(order)
    await writeStore(store)
    return order
  })
}

export async function updateOrderFile(
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

export async function getCardTokenByEmailFile(email: string) {
  const store = await readStore()
  return store.tokens.find((token) => token.customerEmail === email)
}

export async function upsertCardTokenFile(token: SavedCardToken) {
  return withWriteLock(async () => {
    const store = await readStore()
    const index = store.tokens.findIndex(
      (item) => item.customerEmail === token.customerEmail,
    )

    if (index === -1) {
      store.tokens.unshift(token)
    } else {
      store.tokens[index] = token
    }

    await writeStore(store)
    return token
  })
}

export async function touchCardTokenUsedAtFile(email: string, usedAt: string) {
  return withWriteLock(async () => {
    const store = await readStore()
    const index = store.tokens.findIndex((item) => item.customerEmail === email)

    if (index === -1) {
      return
    }

    store.tokens[index] = { ...store.tokens[index], lastUsedAt: usedAt }
    await writeStore(store)
  })
}

export async function deleteCardTokenFile(email: string) {
  return withWriteLock(async () => {
    const store = await readStore()
    store.tokens = store.tokens.filter((item) => item.customerEmail !== email)
    await writeStore(store)
  })
}
