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
| `order_count() -> u64` | – | Number of orders **ever created** on this deployment, including released and refunded ones (it is not a count of active orders). Order indexes run `1..=order_count()`. |
| `list_orders(start: u64, limit: u32) -> Vec<Escrow>` | – | Returns the orders (any status) stored at index slots `start ..= min(start + limit - 1, order_count())`, oldest first. |

- **Keys:** escrows are stored by `(seller, trade_id)` in persistent storage. A sequential index (`Order(i) -> (seller, trade_id)` plus the reverse `EscrowOrder(seller, trade_id) -> i`) supports bounded listing. Because only the seller can create under their own address, a third party cannot front-run a trade id or claim another seller's index slot.
- **TTL:** `create`, `release` and `refund` extend the escrow entry **and both of its index entries** together to ~30 days. A closed (released or refunded) order is never written again, so about 30 days after it closes its three entries are **archived**.
- **Events:** `escrow_created`, `escrow_released`, `escrow_refunded`. The topics are `[name, seller, trade_id]`.
- **Errors:** `AlreadyExists=1`, `NotFound=2`, `NotFunded=3` (already released or refunded), `InvalidAmount=4`, `SameParty=5`, `TooEarly=6`, `NotAParty=7`, `InvalidLimit=8` (`list_orders` limit outside 1–25), `OrderIndexFull=9` (the u64 order counter would overflow), `InvalidStart=10` (`list_orders` called with `start = 0`). Codes are only ever appended, never renumbered.
- **No admin, no on-chain dispute resolution.** In Luminary a dispute is only a status. Note that once the timeout has passed, the seller can reclaim funds that were never released.

#### Listing orders (`order_count` / `list_orders`)

- **Pagination.** `start` is 1-based; `start = 0` fails with `InvalidStart`. `limit` must be 1–25 (`MAX_ORDER_PAGE_SIZE`; each slot reads two persistent entries, so 25 keeps a page well inside Soroban's per-transaction read limits), otherwise `InvalidLimit`. `limit` counts **index slots scanned, not orders returned**, so a page can be shorter than `limit`. Page with `start = 1, 1 + limit, 1 + 2·limit, …` and stop once `start > order_count()`. A `start` past the end returns an empty list, not an error. Do not stop at the first short or empty page, and do not advance `start` by the number of items returned.
- **Archived entries are not skipped.** Soroban does not delete a persistent entry when its TTL runs out; it archives it, and contract code cannot detect that or skip it. A `list_orders` page whose range includes an archived order (or index entry) **fails** until those entries are restored. RPC `simulateTransaction` returns a restore preamble for this, and the caller has to submit (and pay for) the restore before the page can be read. In practice only roughly the last 30 days of orders can be listed without restores. For long-lived or historical listings, index the `escrow_created` events (RPC `getEvents` or an indexer) or use the Luminary database instead of `list_orders`.
- **Untrusted contents.** `create` accepts any token address and only requires the seller's signature, so anyone can add orders to the global index, including spam and orders with fake tokens or impersonated buyers. Consumers **must** filter by the real USDC SAC (`token == ESCROW_TOKEN_ID`) and match `(seller, trade_id)` against the Luminary database before showing or trusting an order.
- **Every order is public.** The list exposes seller, buyer, token, amount and status of every escrow. That data is already public on-chain, but this makes enumerating it a single paginated call.

#### Redeploy (done 2026-11)

`order_count`, `list_orders`, the `trade_id` field in `Escrow` and errors 8–10 exist **only in deployments of the current code**. The contract has no admin, no constructor/initializer and no upgrade entrypoint, so a deployment cannot be upgraded in place: the current code was deployed as a **new contract** (below). The previous contract is kept for trades already funded on it.

Switching the API (`ESCROW_CONTRACT_ID`) to the new id:

- each trade stores the `escrow_contract_id` it was created with, and the API verifies `release`/`refund` against that stored id, so trades already funded on the old contract keep working and must be released or refunded **on the old contract**;
- before switching, let `pending` trades on the old id be funded or expire. A deposit made on the old contract after the switch is checked against the new id and will not be recognised.

### Testnet deployments

Current (has `order_count` / `list_orders`):

| | |
| --- | --- |
| Contract id | `CBWCY3KMNME5TKJTIRYNA3F32BJ6CG2UWIP7F6I6WYTK2HCAL23AWGKR` |
| Wasm hash | `8414fff8366ad2bc2794fd2e82895fd99b9957e110590afcfad521760d6ee7cd` (soroban-sdk 29.0.1, stellar-cli 30.0.1, rustc 1.98.0). Rebuilding `contract-luminary` with that toolchain reproduces it byte for byte; other rustc versions give a different hash for the same source |
| Deployed by | the Luminary team, 2026-11 (no admin rights; the contract has none) |
| USDC SAC (testnet) | `CBIELTK6YBZJU5UP2WWQEUCYKLPU6AUNZ2BQ4WWFEIE3USCIHMXQDAMA`. The contract stores no token: each escrow carries the token passed to `create`, and the API only accepts this one (`ESCROW_TOKEN_ID`) |

Previous (pre-order-listing build, kept only for trades funded on it; no `order_count` / `list_orders`, and `Escrow` has no `trade_id` field):

| | |
| --- | --- |
| Contract id | `CA77HZ3YHCNKXG6M2OZKN7QAI7UDEEOX2AHDEQU5LO4DTD7QHI6K6BOI` |
| Wasm hash | `1f2a2340fe48dfb2a656c296353fe96d253dae65dc6480baf7d2ba2b6cdc94fa` (soroban-sdk 29.0.1, stellar-cli 30.0.1) |
| Deployed by | throwaway Friendbot-funded key `GDIFRKTR4O4VWDWDQ4KACJECQGTEZU66KCYTMBMBLFMTAT7ZVCFA2RWX` |

Check a deployment with read-only simulations (nothing is submitted):

```sh
stellar contract invoke --id <C…> --source-account deployer --network testnet --send=no -- order_count
stellar contract invoke --id <C…> --source-account deployer --network testnet --send=no -- list_orders --start 1 --limit 25
```

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
