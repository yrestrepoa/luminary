#![cfg(test)]
extern crate std;

use super::*;
use soroban_sdk::{
    testutils::{
        storage::Persistent as _, Address as _, AuthorizedFunction, Events as _, Ledger, MockAuth,
        MockAuthInvoke,
    },
    token::{StellarAssetClient, TokenClient},
    Address, Env, Event as _, IntoVal, Symbol,
};

const AMOUNT: i128 = 105_000_000; // 10.5 USDC (7 decimals)
const TRADE: u64 = 42;

struct Setup<'a> {
    env: Env,
    contract: Address,
    client: EscrowContractClient<'a>,
    token: TokenClient<'a>,
    seller: Address,
    buyer: Address,
}

fn setup() -> Setup<'static> {
    let env = Env::default();
    // Long enough minimum TTLs so entries survive the ledger jumps in the timeout tests.
    env.ledger().with_mut(|li| {
        li.sequence_number = 1_000;
        li.min_persistent_entry_ttl = 100_000;
        li.min_temp_entry_ttl = 100_000;
        li.max_entry_ttl = 3_110_400;
    });

    let admin = Address::generate(&env);
    let sac = env.register_stellar_asset_contract_v2(admin);
    let token = TokenClient::new(&env, &sac.address());
    let seller = Address::generate(&env);
    let buyer = Address::generate(&env);

    env.mock_all_auths();
    StellarAssetClient::new(&env, &sac.address()).mint(&seller, &(AMOUNT * 2));

    let contract = env.register(EscrowContract, ());
    let client = EscrowContractClient::new(&env, &contract);
    Setup {
        env,
        contract,
        client,
        token,
        seller,
        buyer,
    }
}

impl Setup<'_> {
    fn create(&self) -> Escrow {
        self.client.create(
            &self.seller,
            &self.buyer,
            &self.token.address,
            &AMOUNT,
            &TRADE,
        )
    }

    fn advance(&self, ledgers: u32) {
        self.env
            .ledger()
            .with_mut(|li| li.sequence_number += ledgers);
    }

    /// Creates a 1-stroop escrow for `seller` (who must hold enough balance).
    fn create_for(&self, seller: &Address, trade_id: u64) -> Escrow {
        self.client
            .create(seller, &self.buyer, &self.token.address, &1, &trade_id)
    }

    /// Asserts that the escrow of `(self.seller, trade_id)` and both of its order-index
    /// entries (`EscrowOrder` and `Order(order_id)`) live for at least `TTL_THRESHOLD`.
    fn assert_order_ttls(&self, trade_id: u64, order_id: u64) {
        let keys = [
            DataKey::Escrow(self.seller.clone(), trade_id),
            DataKey::EscrowOrder(self.seller.clone(), trade_id),
            DataKey::Order(order_id),
        ];
        for key in &keys {
            let ttl = self.env.as_contract(&self.contract, || {
                self.env.storage().persistent().get_ttl(key)
            });
            assert!(ttl >= TTL_THRESHOLD, "ttl {ttl} should cover ~30 days");
        }
    }
}

#[test]
fn create_locks_funds_and_records_escrow() {
    let s = setup();
    let escrow = s.create();

    // EscrowCreated emitted by the escrow contract (the token emits its own transfer event).
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract),
        [EscrowCreated {
            seller: s.seller.clone(),
            trade_id: TRADE,
            buyer: s.buyer.clone(),
            token: s.token.address.clone(),
            amount: AMOUNT,
            refund_after_ledger: 1_000 + REFUND_TIMEOUT_LEDGERS,
        }
        .to_xdr(&s.env, &s.contract)]
    );

    // Only the seller authorized create, including the nested token transfer.
    assert_eq!(
        s.env.auths(),
        std::vec![(
            s.seller.clone(),
            soroban_sdk::testutils::AuthorizedInvocation {
                function: AuthorizedFunction::Contract((
                    s.contract.clone(),
                    Symbol::new(&s.env, "create"),
                    (
                        s.seller.clone(),
                        s.buyer.clone(),
                        s.token.address.clone(),
                        AMOUNT,
                        TRADE
                    )
                        .into_val(&s.env),
                )),
                sub_invocations: std::vec![soroban_sdk::testutils::AuthorizedInvocation {
                    function: AuthorizedFunction::Contract((
                        s.token.address.clone(),
                        Symbol::new(&s.env, "transfer"),
                        (s.seller.clone(), s.contract.clone(), AMOUNT).into_val(&s.env),
                    )),
                    sub_invocations: std::vec![],
                }],
            }
        )]
    );

    assert_eq!(escrow.status, Status::Funded);
    assert_eq!(escrow.refund_after_ledger, 1_000 + REFUND_TIMEOUT_LEDGERS);
    assert_eq!(s.token.balance(&s.contract), AMOUNT);
    assert_eq!(s.token.balance(&s.seller), AMOUNT);
    assert_eq!(s.client.get_escrow(&s.seller, &TRADE), escrow);
}

#[test]
fn orders_can_be_listed_with_pagination() {
    let s = setup();
    let first = s.create();
    let second_trade_id = TRADE + 1;
    s.client.create(
        &s.seller,
        &s.buyer,
        &s.token.address,
        &AMOUNT,
        &second_trade_id,
    );

    assert_eq!(s.client.order_count(), 2);
    let first_page = s.client.list_orders(&1, &1);
    assert_eq!(first_page.len(), 1);
    assert_eq!(first_page.get(0).unwrap(), first);

    let second_page = s.client.list_orders(&2, &1);
    assert_eq!(second_page.len(), 1);
    assert_eq!(second_page.get(0).unwrap().trade_id, second_trade_id);
}

#[test]
fn order_listing_rejects_invalid_page_sizes() {
    let s = setup();
    assert_eq!(
        s.client.try_list_orders(&1, &0),
        Err(Ok(Error::InvalidLimit))
    );
    assert_eq!(
        s.client.try_list_orders(&1, &(MAX_ORDER_PAGE_SIZE + 1)),
        Err(Ok(Error::InvalidLimit))
    );
}

#[test]
fn order_page_size_is_capped_at_25() {
    let s = setup();
    assert_eq!(MAX_ORDER_PAGE_SIZE, 25);
    for trade_id in 0..26 {
        s.create_for(&s.seller, trade_id);
    }
    assert_eq!(s.client.order_count(), 26);
    assert_eq!(s.client.list_orders(&1, &25).len(), 25);
    assert_eq!(s.client.list_orders(&26, &25).len(), 1);
    assert_eq!(
        s.client.try_list_orders(&1, &26),
        Err(Ok(Error::InvalidLimit))
    );
    assert_eq!(
        s.client.try_list_orders(&1, &0),
        Err(Ok(Error::InvalidLimit))
    );
}

#[test]
fn order_pages_handle_start_and_partial_last_page() {
    let s = setup();
    for trade_id in 1..=3 {
        s.create_for(&s.seller, trade_id);
    }
    assert_eq!(s.client.order_count(), 3);

    // Indexes are 1-based: start 0 is rejected instead of silently aliasing start 1.
    assert_eq!(
        s.client.try_list_orders(&0, &1),
        Err(Ok(Error::InvalidStart))
    );

    // Partial last page: slots 2..=11 requested, only 2..=3 exist.
    let page = s.client.list_orders(&2, &10);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap().trade_id, 2);
    assert_eq!(page.get(1).unwrap().trade_id, 3);

    // Paging by `start + limit` visits every order exactly once.
    assert_eq!(s.client.list_orders(&1, &2).len(), 2);
    assert_eq!(s.client.list_orders(&3, &2).len(), 1);

    // Past the end: an empty page, not an error.
    assert_eq!(s.client.list_orders(&4, &10).len(), 0);
    assert_eq!(s.client.list_orders(&u64::MAX, &10).len(), 0);
}

#[test]
fn closed_orders_stay_listed_with_their_status() {
    let s = setup();
    s.create();
    s.create_for(&s.seller, TRADE + 1);
    s.client.release(&s.seller, &TRADE);
    s.client.refund(&s.buyer, &s.seller, &(TRADE + 1));

    assert_eq!(s.client.order_count(), 2);
    let page = s.client.list_orders(&1, &MAX_ORDER_PAGE_SIZE);
    assert_eq!(page.len(), 2);
    assert_eq!(page.get(0).unwrap().status, Status::Released);
    assert_eq!(page.get(1).unwrap().status, Status::Refunded);
}

#[test]
fn orders_from_several_sellers_share_one_index() {
    let s = setup();
    let other_seller = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.token.address).mint(&other_seller, &AMOUNT);
    s.create_for(&s.seller, TRADE);
    s.create_for(&other_seller, TRADE);
    s.create_for(&s.seller, TRADE + 1);

    let page = s.client.list_orders(&1, &MAX_ORDER_PAGE_SIZE);
    assert_eq!(page.len(), 3);
    assert_eq!(page.get(0).unwrap().seller, s.seller);
    assert_eq!(page.get(1).unwrap().seller, other_seller);
    assert_eq!(page.get(2).unwrap().seller, s.seller);
    assert_eq!(page.get(2).unwrap().trade_id, TRADE + 1);
}

#[test]
fn failed_create_does_not_advance_order_count() {
    let s = setup();
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.buyer, &s.token.address, &0, &TRADE),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.seller, &s.token.address, &AMOUNT, &TRADE),
        Err(Ok(Error::SameParty))
    );
    assert!(s
        .client
        .try_create(&s.seller, &s.buyer, &s.token.address, &(AMOUNT * 3), &TRADE)
        .is_err());
    assert_eq!(s.client.order_count(), 0);

    s.create();
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.buyer, &s.token.address, &AMOUNT, &TRADE),
        Err(Ok(Error::AlreadyExists))
    );
    assert_eq!(s.client.order_count(), 1);
    assert_eq!(s.client.list_orders(&1, &MAX_ORDER_PAGE_SIZE).len(), 1);
}

#[test]
fn order_index_ttl_is_extended_on_create_release_and_refund() {
    let s = setup();
    s.create();
    s.create_for(&s.seller, TRADE + 1);
    s.assert_order_ttls(TRADE, 1);
    s.assert_order_ttls(TRADE + 1, 2);

    // Two days later every TTL is below the threshold; release and refund must extend
    // the escrow and both index entries again.
    s.advance(2 * DAY_IN_LEDGERS);
    s.client.release(&s.seller, &TRADE);
    s.client.refund(&s.buyer, &s.seller, &(TRADE + 1));
    s.assert_order_ttls(TRADE, 1);
    s.assert_order_ttls(TRADE + 1, 2);
}

#[test]
fn happy_path_release_pays_buyer() {
    let s = setup();
    s.create();
    let escrow = s.client.release(&s.seller, &TRADE);
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract),
        [EscrowReleased {
            seller: s.seller.clone(),
            trade_id: TRADE,
            buyer: s.buyer.clone(),
            amount: AMOUNT,
        }
        .to_xdr(&s.env, &s.contract)]
    );

    assert_eq!(
        s.env.auths()[0].0,
        s.seller,
        "release must be authorized by the seller"
    );
    assert_eq!(escrow.status, Status::Released);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);
    assert_eq!(s.token.balance(&s.contract), 0);
    assert_eq!(
        s.client.get_escrow(&s.seller, &TRADE).status,
        Status::Released
    );
}

#[test]
fn double_release_is_rejected() {
    let s = setup();
    s.create();
    s.client.release(&s.seller, &TRADE);
    assert_eq!(
        s.client.try_release(&s.seller, &TRADE),
        Err(Ok(Error::NotFunded))
    );
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);
}

#[test]
fn refund_after_release_is_rejected() {
    let s = setup();
    s.create();
    s.client.release(&s.seller, &TRADE);
    assert_eq!(
        s.client.try_refund(&s.buyer, &s.seller, &TRADE),
        Err(Ok(Error::NotFunded))
    );
}

#[test]
fn duplicate_create_is_rejected() {
    let s = setup();
    s.create();
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.buyer, &s.token.address, &AMOUNT, &TRADE),
        Err(Ok(Error::AlreadyExists))
    );
    assert_eq!(s.token.balance(&s.contract), AMOUNT);
}

#[test]
fn same_trade_id_is_independent_per_seller() {
    let s = setup();
    s.create();
    let other_seller = Address::generate(&s.env);
    StellarAssetClient::new(&s.env, &s.token.address).mint(&other_seller, &AMOUNT);
    s.client
        .create(&other_seller, &s.buyer, &s.token.address, &AMOUNT, &TRADE);
    assert_eq!(s.token.balance(&s.contract), AMOUNT * 2);
}

#[test]
fn invalid_create_arguments_are_rejected() {
    let s = setup();
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.buyer, &s.token.address, &0, &TRADE),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.buyer, &s.token.address, &-1, &TRADE),
        Err(Ok(Error::InvalidAmount))
    );
    assert_eq!(
        s.client
            .try_create(&s.seller, &s.seller, &s.token.address, &AMOUNT, &TRADE),
        Err(Ok(Error::SameParty))
    );
}

#[test]
fn create_fails_without_enough_balance() {
    let s = setup();
    assert!(s
        .client
        .try_create(&s.seller, &s.buyer, &s.token.address, &(AMOUNT * 3), &TRADE)
        .is_err());
    assert_eq!(
        s.client.try_get_escrow(&s.seller, &TRADE),
        Err(Ok(Error::NotFound))
    );
}

#[test]
fn unknown_escrow_is_not_found() {
    let s = setup();
    assert_eq!(
        s.client.try_release(&s.seller, &7),
        Err(Ok(Error::NotFound))
    );
    assert_eq!(
        s.client.try_refund(&s.buyer, &s.seller, &7),
        Err(Ok(Error::NotFound))
    );
    assert_eq!(
        s.client.try_get_escrow(&s.seller, &7),
        Err(Ok(Error::NotFound))
    );
}

// ------------------------------------------------------------------ authorization

#[test]
fn create_requires_seller_auth() {
    let s = setup();
    // Only the buyer signs: the seller's require_auth must fail.
    let res = s
        .client
        .mock_auths(&[MockAuth {
            address: &s.buyer,
            invoke: &MockAuthInvoke {
                contract: &s.contract,
                fn_name: "create",
                args: (
                    s.seller.clone(),
                    s.buyer.clone(),
                    s.token.address.clone(),
                    AMOUNT,
                    TRADE,
                )
                    .into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .try_create(&s.seller, &s.buyer, &s.token.address, &AMOUNT, &TRADE);
    assert!(res.is_err());
    assert_eq!(s.token.balance(&s.seller), AMOUNT * 2);
}

#[test]
fn buyer_cannot_release() {
    let s = setup();
    s.create();
    let res = s
        .client
        .mock_auths(&[MockAuth {
            address: &s.buyer,
            invoke: &MockAuthInvoke {
                contract: &s.contract,
                fn_name: "release",
                args: (s.seller.clone(), TRADE).into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .try_release(&s.seller, &TRADE);
    assert!(res.is_err());
    assert_eq!(s.token.balance(&s.buyer), 0);
    assert_eq!(
        s.client.get_escrow(&s.seller, &TRADE).status,
        Status::Funded
    );
}

#[test]
fn release_with_seller_auth_only_succeeds() {
    let s = setup();
    s.create();
    s.client
        .mock_auths(&[MockAuth {
            address: &s.seller,
            invoke: &MockAuthInvoke {
                contract: &s.contract,
                fn_name: "release",
                args: (s.seller.clone(), TRADE).into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .release(&s.seller, &TRADE);
    assert_eq!(s.token.balance(&s.buyer), AMOUNT);
}

#[test]
fn refund_caller_must_sign() {
    let s = setup();
    s.create();
    // Claims to be the buyer, but only the seller signed.
    let res = s
        .client
        .mock_auths(&[MockAuth {
            address: &s.seller,
            invoke: &MockAuthInvoke {
                contract: &s.contract,
                fn_name: "refund",
                args: (s.buyer.clone(), s.seller.clone(), TRADE).into_val(&s.env),
                sub_invokes: &[],
            },
        }])
        .try_refund(&s.buyer, &s.seller, &TRADE);
    assert!(res.is_err());
    assert_eq!(s.token.balance(&s.contract), AMOUNT);
}

#[test]
fn stranger_cannot_refund() {
    let s = setup();
    s.create();
    let stranger = Address::generate(&s.env);
    s.advance(REFUND_TIMEOUT_LEDGERS + 1);
    assert_eq!(
        s.client.try_refund(&stranger, &s.seller, &TRADE),
        Err(Ok(Error::NotAParty))
    );
}

// ------------------------------------------------------------------ refunds

#[test]
fn buyer_can_refund_any_time() {
    let s = setup();
    s.create();
    let escrow = s.client.refund(&s.buyer, &s.seller, &TRADE);
    assert_eq!(
        s.env.events().all().filter_by_contract(&s.contract),
        [EscrowRefunded {
            seller: s.seller.clone(),
            trade_id: TRADE,
            by: s.buyer.clone(),
            amount: AMOUNT,
        }
        .to_xdr(&s.env, &s.contract)]
    );
    assert_eq!(s.env.auths()[0].0, s.buyer);
    assert_eq!(escrow.status, Status::Refunded);
    assert_eq!(s.token.balance(&s.seller), AMOUNT * 2);
    assert_eq!(s.token.balance(&s.contract), 0);
    assert_eq!(
        s.client.try_release(&s.seller, &TRADE),
        Err(Ok(Error::NotFunded))
    );
}

#[test]
fn seller_refund_before_timeout_is_rejected() {
    let s = setup();
    s.create();
    s.advance(REFUND_TIMEOUT_LEDGERS - 1);
    assert_eq!(
        s.client.try_refund(&s.seller, &s.seller, &TRADE),
        Err(Ok(Error::TooEarly))
    );
    assert_eq!(s.token.balance(&s.contract), AMOUNT);
}

#[test]
fn seller_refund_after_timeout_succeeds() {
    let s = setup();
    s.create();
    s.advance(REFUND_TIMEOUT_LEDGERS);
    let escrow = s.client.refund(&s.seller, &s.seller, &TRADE);
    assert_eq!(s.env.auths()[0].0, s.seller);
    assert_eq!(escrow.status, Status::Refunded);
    assert_eq!(s.token.balance(&s.seller), AMOUNT * 2);
    assert_eq!(s.token.balance(&s.buyer), 0);
    // Double refund rejected.
    assert_eq!(
        s.client.try_refund(&s.seller, &s.seller, &TRADE),
        Err(Ok(Error::NotFunded))
    );
}

#[test]
fn escrow_entry_ttl_is_extended() {
    let s = setup();
    s.create();
    let ttl = s.env.as_contract(&s.contract, || {
        s.env
            .storage()
            .persistent()
            .get_ttl(&DataKey::Escrow(s.seller.clone(), TRADE))
    });
    assert!(ttl >= TTL_THRESHOLD, "ttl {ttl} should cover ~30 days");
}
