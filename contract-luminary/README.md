# Soroban Project

## Project Structure

This repository uses the recommended structure for a Soroban project:

```text
.
├── contracts
│   └── hello_world
│       ├── src
│       │   ├── lib.rs
│       │   └── test.rs
│       └── Cargo.toml
├── Cargo.toml
├── AGENTS.md
└── README.md
```

- New Soroban contracts can be put in `contracts`, each in their own directory. There is already a `hello_world` contract in there to get you started.
- If you initialized this project with any other example contracts via `--with-example`, those contracts will be in the `contracts` directory as well.
- Contracts should have their own `Cargo.toml` files that rely on the top-level `Cargo.toml` workspace for their dependencies.
- Frontend libraries can be added to the top-level directory as well. If you initialized this project with a frontend template via `--frontend-template` you will have those files already included.

## `luminary-escrow` contract

[`contracts/escrow`](contracts/escrow) holds a seller's USDC (or any Stellar Asset Contract token) for one Luminary trade.

| Function | Auth | Effect |
| --- | --- | --- |
| `create(seller, buyer, token, amount: i128, trade_id: u64) -> Escrow` | `seller` | Transfers `amount` of `token` from `seller` into the contract. Fails if `(seller, trade_id)` already exists, if `amount <= 0`, or if `seller == buyer`. |
| `release(seller, trade_id) -> Escrow` | `seller` | Sends the escrowed amount to the buyer. Status becomes `Released`. |
| `refund(caller, seller, trade_id) -> Escrow` | `caller` | Returns the amount to the seller. `caller` is either the **buyer** (any time) or the **seller**, and the seller may only do it once `refund_after_ledger` is reached (created ledger + 17 280 ledgers ≈ 24 h). Status becomes `Refunded`. |
| `get_escrow(seller, trade_id) -> Escrow` | – | Read-only view: `{ trade_id, seller, buyer, token, amount, refund_after_ledger, status }`, where `status` is `0` Funded, `1` Released, or `2` Refunded. |
| `order_count() -> u64` | – | Highest sequential order index assigned. Expired entries may leave gaps. |
| `list_orders(start, limit) -> Vec<Escrow>` | – | Lists retained entries from the 1-based `start` index; `limit` must be 1–100. Expired entries are skipped. |

- **Keys:** escrows are stored by `(seller, trade_id)` in persistent storage, and every write extends the TTL to ~30 days. A sequential index supports bounded listing; because only the seller can create under their own address, a third party cannot front-run a trade id.
- **Events:** `escrow_created`, `escrow_released`, `escrow_refunded`. The topics are `[name, seller, trade_id]`.
- **Errors:** `AlreadyExists=1`, `NotFound=2`, `NotFunded=3` (already released or refunded), `InvalidAmount=4`, `SameParty=5`, `TooEarly=6`, `NotAParty=7`.
- **No admin, no on-chain dispute resolution.** In Luminary a dispute is only a status. Note that once the timeout has passed, the seller can reclaim funds that were never released.

### Testnet deployment

| | |
| --- | --- |
| Contract id | `CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI` |
| Wasm hash | `1f2a2340fe48dfb2a656c296353fe96d253dae65dc6480baf7d2ba2b6cdc94fa` (soroban-sdk 29.0.1, stellar-cli 30.0.1) |
| Deployed by | throwaway Friendbot-funded key `GDIFRKTR4O4VWDWDQ4KACJECQGTEZU66KCYTMBMBLFMTAT7ZVCFA2RWX` (no admin rights; the contract has none) |
| USDC SAC (testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA` |

Testnet can be reset. If the contract disappears, redeploy it:

```sh
stellar keys generate deployer --network testnet --fund
stellar contract build
stellar contract deploy --wasm target/wasm32v1-none/release/luminary_escrow.wasm \
  --source-account deployer --network testnet --alias luminary_escrow
# then set ESCROW_CONTRACT_ID=<C…> for the API
```

### Building without a local Rust toolchain

Docker works. Use any `rust` image, then add the `wasm32v1-none` target and a [stellar-cli release](https://github.com/stellar/stellar-cli/releases) binary (it needs `libdbus-1-3` and `libudev1`). From `contract-luminary/`, run `cargo test` and `stellar contract build`.
