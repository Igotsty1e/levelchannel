import { paymentConfig } from '@/lib/payments/config'
import type { PaymentOrder } from '@/lib/payments/types'
import {
  createOrderFile,
  getOrderFile,
  listOrdersFile,
  updateOrderFile,
} from '@/lib/payments/store-file'
import {
  createOrderPostgres,
  getOrderPostgres,
  listOrdersPostgres,
  updateOrderPostgres,
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
