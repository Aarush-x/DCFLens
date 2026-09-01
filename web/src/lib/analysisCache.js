const DATABASE_NAME = 'dcflens-analysis-cache'
const STORE_NAME = 'analysis'
const DATABASE_VERSION = 1
const CACHE_SCHEMA_VERSION = 1
const MAX_ENTRIES = 12
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000

/** Market data is deliberately never persisted with the filing analysis. */
export function stripMarketContext(envelope) {
  if (!envelope || typeof envelope !== 'object') return null
  const { market_price: _marketPrice, plausibility: _plausibility, ...core } = envelope
  return core.analysis && core.ticker ? core : null
}

export function mergeMarketContext(core, context) {
  if (!core || typeof core !== 'object') return null
  if (!context || typeof context !== 'object') return core
  return {
    ...core,
    market_price: context.market_price,
    plausibility: context.plausibility,
  }
}

export async function readPersistedAnalysis(ticker) {
  const database = await openDatabase()
  if (!database) return null
  try {
    const entry = await request(
      database.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(ticker),
    )
    if (
      !entry
      || entry.schemaVersion !== CACHE_SCHEMA_VERSION
      || Date.now() - entry.savedAt > MAX_AGE_MS
    ) return null
    return stripMarketContext(entry.envelope)
  } catch {
    return null
  } finally {
    database.close()
  }
}

export async function persistAnalysis(ticker, envelope) {
  const core = stripMarketContext(envelope)
  if (!core || core.ticker !== ticker) return
  const database = await openDatabase()
  if (!database) return
  try {
    const transaction = database.transaction(STORE_NAME, 'readwrite')
    const completed = transactionDone(transaction)
    const store = transaction.objectStore(STORE_NAME)
    store.put({
      ticker,
      schemaVersion: CACHE_SCHEMA_VERSION,
      savedAt: Date.now(),
      envelope: core,
    })
    await completed
    await prune(database)
  } catch {
    // Browser persistence is a speed enhancement, never a correctness dependency.
  } finally {
    database.close()
  }
}

async function prune(database) {
  const transaction = database.transaction(STORE_NAME, 'readwrite')
  const completed = transactionDone(transaction)
  const store = transaction.objectStore(STORE_NAME)
  const count = await request(store.count())
  let remaining = count - MAX_ENTRIES
  if (remaining > 0) {
    await new Promise((resolve, reject) => {
      const cursor = store.index('savedAt').openCursor()
      cursor.onerror = () => reject(cursor.error)
      cursor.onsuccess = () => {
        const item = cursor.result
        if (!item || remaining <= 0) return resolve()
        item.delete()
        remaining -= 1
        item.continue()
      }
    })
  }
  await completed
}

function openDatabase() {
  if (typeof indexedDB === 'undefined') return Promise.resolve(null)
  return new Promise((resolve) => {
    let settled = false
    const finish = (database) => {
      if (settled) {
        database?.close()
        return
      }
      settled = true
      resolve(database)
    }
    const opening = indexedDB.open(DATABASE_NAME, DATABASE_VERSION)
    opening.onerror = () => finish(null)
    opening.onblocked = () => finish(null)
    opening.onupgradeneeded = () => {
      const database = opening.result
      const store = database.createObjectStore(STORE_NAME, { keyPath: 'ticker' })
      store.createIndex('savedAt', 'savedAt')
    }
    opening.onsuccess = () => finish(opening.result)
  })
}

function request(operation) {
  return new Promise((resolve, reject) => {
    operation.onsuccess = () => resolve(operation.result)
    operation.onerror = () => reject(operation.error)
  })
}

function transactionDone(transaction) {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve()
    transaction.onerror = () => reject(transaction.error)
    transaction.onabort = () => reject(transaction.error)
  })
}
