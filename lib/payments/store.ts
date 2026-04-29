import { paymentConfig } from '@/lib/payments/config'
import type { PaymentOrder, SavedCardToken } from '@/lib/payments/types'
import {
  createOrderFile,
  deleteCardTokenFile,
  getCardTokenByEmailFile,
  getOrderFile,
  listOrdersFile,
  touchCardTokenUsedAtFile,
  updateOrderFile,
  upsertCardTokenFile,
} from '@/lib/payments/store-file'
import {
  createOrderPostgres,
  deleteCardTokenPostgres,
  getCardTokenByEmailPostgres,
  getOrderPostgres,
  listOrdersPostgres,
  touchCardTokenUsedAtPostgres,
  updateOrderPostgres,
  upsertCardTokenPostgres,
} from '@/lib/payments/store-postgres'

export async function listOrders() {
  if (paymentConfig.storageBackend === 'postgres') {
    return listOrdersPostgres()
  }

  return listOrdersFile()
}

export async function getOrder(invoiceId: string) {
  if (paymentConfig.storageBackend === 'postgres') {
    return getOrderPostgres(invoiceId)
  }

  return getOrderFile(invoiceId)
}

export async function createOrder(order: PaymentOrder) {
  if (paymentConfig.storageBackend === 'postgres') {
    return createOrderPostgres(order)
  }

  return createOrderFile(order)
}

export async function updateOrder(
  invoiceId: string,
  updater: (order: PaymentOrder) => PaymentOrder,
) {
  if (paymentConfig.storageBackend === 'postgres') {
    return updateOrderPostgres(invoiceId, updater)
  }

  return updateOrderFile(invoiceId, updater)
}

export async function getCardTokenByEmail(email: string) {
  if (paymentConfig.storageBackend === 'postgres') {
    return getCardTokenByEmailPostgres(email)
  }

  return getCardTokenByEmailFile(email)
}

export async function upsertCardToken(token: SavedCardToken) {
  if (paymentConfig.storageBackend === 'postgres') {
    return upsertCardTokenPostgres(token)
  }

  return upsertCardTokenFile(token)
}

export async function touchCardTokenUsedAt(email: string, usedAt: string) {
  if (paymentConfig.storageBackend === 'postgres') {
    return touchCardTokenUsedAtPostgres(email, usedAt)
  }

  return touchCardTokenUsedAtFile(email, usedAt)
}

export async function deleteCardToken(email: string) {
  if (paymentConfig.storageBackend === 'postgres') {
    return deleteCardTokenPostgres(email)
  }

  return deleteCardTokenFile(email)
}
