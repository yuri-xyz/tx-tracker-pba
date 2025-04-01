import type {
  API,
  FinalizedEvent,
  IncomingEvent,
  NewBlockEvent,
  NewTransactionEvent,
  OutputAPI,
  Settled,
} from "../types"

export default function yuriXyz(api: API, outputApi: OutputAPI) {
  // Requirements:
  //
  // 1) When a transaction becomes "settled"-which always occurs upon receiving a "newBlock" event-
  //    you must call `outputApi.onTxSettled`.
  //
  //    - Multiple transactions may settle in the same block, so `onTxSettled` could be called
  //      multiple times per "newBlock" event.
  //    - Ensure callbacks are invoked in the same order as the transactions originally arrived.
  //
  // 2) When a transaction becomes "done"-meaning the block it was settled in gets finalized-
  //    you must call `outputApi.onTxDone`.
  //
  //    - Multiple transactions may complete upon a single "finalized" event.
  //    - As above, maintain the original arrival order when invoking `onTxDone`.
  //    - Keep in mind that the "finalized" event is not emitted for all finalized blocks.
  //
  // Notes:
  // - It is **not** ok to make redundant calls to either `onTxSettled` or `onTxDone`.
  // - It is ok to make redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`
  //
  // Bonus 1:
  // - Avoid making redundant calls to `getBody`, `isTxValid` and `isTxSuccessful`.
  //
  // Bonus 2:
  // - Upon receiving a "finalized" event, call `api.unpin` to unpin blocks that are either:
  //     a) pruned, or
  //     b) older than the currently finalized block.

  type Hash = string
  type Tx = string

  type SettledTx = {
    blockHash: Hash
    tx: Tx
    state: Settled
  }

  const pendingTxs: Tx[] = []
  const settledTxs: SettledTx[] = []
  const finalizedBlocks: Set<Hash> = new Set()

  const onNewBlock = ({ blockHash, parent }: NewBlockEvent) => {
    const blockTxs = new Set(api.getBody(blockHash))

    for (const tx of pendingTxs) {
      if (!blockTxs.has(tx)) {
        continue
      }

      const isValid = api.isTxValid(blockHash, tx)

      const state: Settled = isValid
        ? {
            blockHash,
            type: "valid",
            successful: api.isTxSuccessful(blockHash, tx),
          }
        : {
            blockHash,
            type: "invalid",
          }

      outputApi.onTxSettled(tx, state)
      settledTxs.push({ blockHash, tx, state })
      pendingTxs.splice(pendingTxs.indexOf(tx), 1)
    }
  }

  const onNewTx = ({ value: transaction }: NewTransactionEvent) => {
    // Note: assume that all transactions are valid.

    pendingTxs.push(transaction)
  }

  const onFinalized = ({ blockHash }: FinalizedEvent) => {
    finalizedBlocks.add(blockHash)

    for (const settledTx of settledTxs) {
      // Ensure the finalized block is the same as the one we have in the settled tx.
      if (settledTx.blockHash !== blockHash) {
        continue
      }

      outputApi.onTxDone(settledTx.tx, {
        blockHash,
        type: api.isTxValid(blockHash, settledTx.tx) ? "valid" : "invalid",
        successful: api.isTxSuccessful(blockHash, settledTx.tx),
      })

      settledTxs.splice(settledTxs.indexOf(settledTx), 1)
    }
  }

  return (event: IncomingEvent) => {
    switch (event.type) {
      case "newBlock": {
        onNewBlock(event)
        break
      }
      case "newTransaction": {
        onNewTx(event)
        break
      }
      case "finalized":
        onFinalized(event)
    }
  }
}
