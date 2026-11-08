//! Luminary escrow: holds a seller's tokens (USDC via its Stellar Asset Contract) for one
//! P2P trade until the seller releases them to the buyer, or they are refunded to the seller.
//!
//! * `create`  — seller deposits `amount` of `token` for `trade_id` (seller auth).
//! * `release` — seller sends the escrowed amount to the buyer (seller auth).
//! * `refund`  — returns the amount to the seller. Allowed for the buyer at any time
//!   (voluntary cancel), or for the seller once `refund_after_ledger` has been reached.
//! * `order_count` / `list_orders` — read-only, paginated view of every escrow ever created
//!   on this deployment (see the README for archival and filtering caveats).
//!
//! Escrows are keyed by `(seller, trade_id)`: only the seller can create an entry under
//! their own address, so nobody can front-run a trade id to block it. There is no admin
//! and no dispute resolution on-chain; disputes are an off-chain status only.
#![no_std]

use soroban_sdk::{
    contract, contracterror, contractevent, contractimpl, contracttype, token, Address, Env, Vec,
};

/// Ledgers per day at ~5 s per ledger.
pub const DAY_IN_LEDGERS: u32 = 17_280;
/// The seller can reclaim an unreleased escrow after this many ledgers (~24 h).
pub const REFUND_TIMEOUT_LEDGERS: u32 = DAY_IN_LEDGERS;
/// Escrow entries (and the contract instance) are kept alive for ~30 days after each write.
const TTL_EXTEND_TO: u32 = 30 * DAY_IN_LEDGERS;
const TTL_THRESHOLD: u32 = TTL_EXTEND_TO - DAY_IN_LEDGERS;
/// Maximum index slots scanned by one `list_orders` call. Each slot reads two persistent
/// entries (`Order(i)` and the `Escrow` it points to), so a page of 25 touches ~50 entries
/// plus the instance and code: well inside Soroban's per-transaction footprint/read limits.
pub const MAX_ORDER_PAGE_SIZE: u32 = 25;

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Error {
    /// An escrow already exists for this seller and trade id.
    AlreadyExists = 1,
    /// No escrow for this seller and trade id.
    NotFound = 2,
    /// The escrow was already released or refunded.
    NotFunded = 3,
    /// Amount must be greater than zero.
    InvalidAmount = 4,
    /// Seller and buyer must be different addresses.
    SameParty = 5,
    /// The seller tried to refund before `refund_after_ledger`.
    TooEarly = 6,
    /// `refund` caller is neither the buyer nor the seller.
    NotAParty = 7,
    /// The order-list page size must be between 1 and `MAX_ORDER_PAGE_SIZE` (25).
    InvalidLimit = 8,
    /// The sequential order index has reached its maximum value.
    OrderIndexFull = 9,
    /// Order indexes are 1-based: `list_orders` was called with `start == 0`.
    InvalidStart = 10,
}

#[contracttype]
#[derive(Copy, Clone, Debug, Eq, PartialEq)]
#[repr(u32)]
pub enum Status {
    Funded = 0,
    Released = 1,
    Refunded = 2,
}

#[contracttype]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct Escrow {
    pub trade_id: u64,
    pub seller: Address,
    pub buyer: Address,
    pub token: Address,
    pub amount: i128,
    /// First ledger at which the seller may reclaim the funds.
    pub refund_after_ledger: u32,
    pub status: Status,
}

#[contracttype]
#[derive(Clone)]
pub enum DataKey {
    Escrow(Address, u64),
    EscrowOrder(Address, u64),
    Order(u64),
    NextOrder,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowCreated {
    #[topic]
    pub seller: Address,
    #[topic]
    pub trade_id: u64,
    pub buyer: Address,
    pub token: Address,
    pub amount: i128,
    pub refund_after_ledger: u32,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowReleased {
    #[topic]
    pub seller: Address,
    #[topic]
    pub trade_id: u64,
    pub buyer: Address,
    pub amount: i128,
}

#[contractevent]
#[derive(Clone, Debug, Eq, PartialEq)]
pub struct EscrowRefunded {
    #[topic]
    pub seller: Address,
    #[topic]
    pub trade_id: u64,
    /// Who triggered the refund (buyer or seller).
    pub by: Address,
    pub amount: i128,
}

#[contract]
pub struct EscrowContract;

fn bump_instance(env: &Env) {
    env.storage()
        .instance()
        .extend_ttl(TTL_THRESHOLD, TTL_EXTEND_TO);
}

fn load(env: &Env, key: &DataKey) -> Result<Escrow, Error> {
    env.storage().persistent().get(key).ok_or(Error::NotFound)
}

fn extend_persistent(env: &Env, key: &DataKey) {
    env.storage()
        .persistent()
        .extend_ttl(key, TTL_THRESHOLD, TTL_EXTEND_TO);
}

/// Writes an escrow and extends, together, the TTL of the escrow and of its two order-index
/// entries (`EscrowOrder` and `Order`), so all three stay alive (and later archive) together.
/// Called by create, release and refund; `create` must write the index entries before this.
fn save(env: &Env, key: &DataKey, escrow: &Escrow) {
    env.storage().persistent().set(key, escrow);
    extend_persistent(env, key);
    let order_key = DataKey::EscrowOrder(escrow.seller.clone(), escrow.trade_id);
    if let Some(order_id) = env.storage().persistent().get::<_, u64>(&order_key) {
        extend_persistent(env, &order_key);
        extend_persistent(env, &DataKey::Order(order_id));
    }
    bump_instance(env);
}

#[contractimpl]
impl EscrowContract {
    /// Moves `amount` of `token` from `seller` into the contract for `trade_id`.
    pub fn create(
        env: Env,
        seller: Address,
        buyer: Address,
        token: Address,
        amount: i128,
        trade_id: u64,
    ) -> Result<Escrow, Error> {
        seller.require_auth();
        if amount <= 0 {
            return Err(Error::InvalidAmount);
        }
        if seller == buyer {
            return Err(Error::SameParty);
        }
        let key = DataKey::Escrow(seller.clone(), trade_id);
        if env.storage().persistent().has(&key) {
            return Err(Error::AlreadyExists);
        }

        let order_id = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::NextOrder)
            .unwrap_or(0)
            .checked_add(1)
            .ok_or(Error::OrderIndexFull)?;
        env.storage().instance().set(&DataKey::NextOrder, &order_id);
        env.storage()
            .persistent()
            .set(&DataKey::Order(order_id), &(seller.clone(), trade_id));
        env.storage()
            .persistent()
            .set(&DataKey::EscrowOrder(seller.clone(), trade_id), &order_id);

        let escrow = Escrow {
            trade_id,
            seller: seller.clone(),
            buyer: buyer.clone(),
            token: token.clone(),
            amount,
            refund_after_ledger: env.ledger().sequence() + REFUND_TIMEOUT_LEDGERS,
            status: Status::Funded,
        };
        save(&env, &key, &escrow);
        token::TokenClient::new(&env, &token).transfer(
            &seller,
            &env.current_contract_address(),
            &amount,
        );

        EscrowCreated {
            seller,
            trade_id,
            buyer,
            token,
            amount,
            refund_after_ledger: escrow.refund_after_ledger,
        }
        .publish(&env);
        Ok(escrow)
    }

    /// Seller releases the escrowed amount to the buyer.
    pub fn release(env: Env, seller: Address, trade_id: u64) -> Result<Escrow, Error> {
        seller.require_auth();
        let key = DataKey::Escrow(seller.clone(), trade_id);
        let mut escrow = load(&env, &key)?;
        if escrow.status != Status::Funded {
            return Err(Error::NotFunded);
        }

        escrow.status = Status::Released;
        save(&env, &key, &escrow);
        token::TokenClient::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.buyer,
            &escrow.amount,
        );

        EscrowReleased {
            seller,
            trade_id,
            buyer: escrow.buyer.clone(),
            amount: escrow.amount,
        }
        .publish(&env);
        Ok(escrow)
    }

    /// Returns the escrowed amount to the seller. `caller` must be the buyer (any time)
    /// or the seller (only from `refund_after_ledger` on).
    pub fn refund(
        env: Env,
        caller: Address,
        seller: Address,
        trade_id: u64,
    ) -> Result<Escrow, Error> {
        caller.require_auth();
        let key = DataKey::Escrow(seller.clone(), trade_id);
        let mut escrow = load(&env, &key)?;
        if caller != escrow.buyer && caller != escrow.seller {
            return Err(Error::NotAParty);
        }
        if escrow.status != Status::Funded {
            return Err(Error::NotFunded);
        }
        if caller == escrow.seller && env.ledger().sequence() < escrow.refund_after_ledger {
            return Err(Error::TooEarly);
        }

        escrow.status = Status::Refunded;
        save(&env, &key, &escrow);
        token::TokenClient::new(&env, &escrow.token).transfer(
            &env.current_contract_address(),
            &escrow.seller,
            &escrow.amount,
        );

        EscrowRefunded {
            seller,
            trade_id,
            by: caller,
            amount: escrow.amount,
        }
        .publish(&env);
        Ok(escrow)
    }

    /// Read-only view of an escrow (used by the Luminary API to verify state).
    pub fn get_escrow(env: Env, seller: Address, trade_id: u64) -> Result<Escrow, Error> {
        load(&env, &DataKey::Escrow(seller, trade_id))
    }

    /// Number of orders ever created on this deployment, including released and refunded
    /// ones. Order indexes are `1..=order_count()`; this is not a count of active orders.
    pub fn order_count(env: Env) -> u64 {
        env.storage()
            .instance()
            .get(&DataKey::NextOrder)
            .unwrap_or(0)
    }

    /// Lists orders (any status) by creation index, scanning the 1-based slots
    /// `start..start + limit`, clamped to `order_count()`. `start == 0` is `InvalidStart`;
    /// `start > order_count()` gives an empty page. `limit` (1..=25) counts slots scanned,
    /// not orders returned; the next page starts at `start + limit`.
    /// An archived entry in the range is not skipped: the call needs a restore first.
    /// Anyone can create orders with any token, so filter by the expected token.
    pub fn list_orders(env: Env, start: u64, limit: u32) -> Result<Vec<Escrow>, Error> {
        if start == 0 {
            return Err(Error::InvalidStart);
        }
        if limit == 0 || limit > MAX_ORDER_PAGE_SIZE {
            return Err(Error::InvalidLimit);
        }

        let count = env
            .storage()
            .instance()
            .get::<_, u64>(&DataKey::NextOrder)
            .unwrap_or(0);
        let mut orders = Vec::new(&env);
        if start > count {
            return Ok(orders);
        }
        // `limit >= 1` here, and saturating_add keeps `end` in range even near u64::MAX.
        let end = start.saturating_add(u64::from(limit) - 1).min(count);
        for order_id in start..=end {
            if let Some((seller, trade_id)) = env
                .storage()
                .persistent()
                .get::<_, (Address, u64)>(&DataKey::Order(order_id))
            {
                if let Ok(escrow) = load(&env, &DataKey::Escrow(seller, trade_id)) {
                    orders.push_back(escrow);
                }
            }
        }
        Ok(orders)
    }
}

mod test;
