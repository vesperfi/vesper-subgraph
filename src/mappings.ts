import {
  ethereum,
  log,
  dataSource,
  Address,
  BigInt,
  BigDecimal,
} from '@graphprotocol/graph-ts';
import { PoolV2, Withdraw, Deposit } from '../types/PoolV2';
import { AddressList } from '../types/AddressList';
import { PoolV3, Transfer } from '../types/PoolV3';
import { Pool } from '../types/schema';
import { toUsd, getStrategy, getStrategyAddress } from './utils';

const VVSPAddressHex = '0xbA4cFE5741b357FA371b506e5db0774aBFeCf8Fc';
const ZeroAddressHex = '0x0000000000000000000000000000000000000000';

// these functions compiles to AssemblyScript. Therefore although we are allowed to code in TS in this file
// we need to do so with the restrictions of AssemblyScript
// * no union types allowed (so we can't reuse a function here)
// * comparisons should be made with == (unless comparing exact pointers)
// * no destructuring

function getPool(address: string): Pool {
  let pool = Pool.load(address);
  if (pool != null) {
    log.info('Returning Pool query for address {}', [address]);
    // Casting required because here we know poolsQuery is not null, but the AssemblyScript compiler
    // is not picking it up
    return pool as Pool;
  }
  log.info('Creating new instance of pool for address {}', [address]);
  let newPool = new Pool(address);
  let zeroString = BigDecimal.fromString('0');
  newPool.totalDebt = BigInt.fromString('0');
  newPool.totalSupply = BigInt.fromString('0');
  newPool.totalRevenue = zeroString;
  newPool.totalRevenueUsd = zeroString;
  newPool.protocolRevenue = zeroString;
  newPool.protocolRevenueUsd = zeroString;
  newPool.supplySideRevenue = zeroString;
  newPool.supplySideRevenueUsd = zeroString;
  return newPool;
}

class Revenue {
  protocolRevenue: BigDecimal;
  protocolRevenueUsd: BigDecimal;
  supplySideRevenue: BigDecimal;
  supplySideRevenueUsd: BigDecimal;
  constructor(
    _protocolRevenue: BigDecimal,
    _supplySideRevenue: BigDecimal,
    decimals: i32,
    tokenValue: BigDecimal,
    tokenAddress: Address
  ) {
    let protocolRevenue = _protocolRevenue.times(tokenValue);
    this.protocolRevenue = protocolRevenue;
    this.protocolRevenueUsd = toUsd(protocolRevenue, decimals, tokenAddress);
    let supplySideRevenue = _supplySideRevenue.times(tokenValue);
    this.supplySideRevenue = supplySideRevenue;
    this.supplySideRevenueUsd = toUsd(
      supplySideRevenue,
      decimals,
      tokenAddress
    );
  }
}

function calculateRevenue(
  interest: BigDecimal,
  decimals: i32,
  tokenValue: BigDecimal,
  tokenAddress: Address
): Revenue {
  // 95% of the fees go to the protocol revenue
  let protocolRevenue = interest.times(BigDecimal.fromString('0.95'));
  // 5% of the fees go to the supply-side revenue
  let supplySideRevenue = interest.times(BigDecimal.fromString('0.05'));
  return new Revenue(
    protocolRevenue,
    supplySideRevenue,
    decimals,
    tokenValue,
    tokenAddress
  );
}

function saveRevenue(poolAddressHex: string, revenue: Revenue): void {
  let pool = getPool(poolAddressHex);
  pool.protocolRevenue = pool.protocolRevenue.plus(revenue.protocolRevenue);
  pool.protocolRevenueUsd = pool.protocolRevenueUsd.plus(
    revenue.protocolRevenueUsd
  );
  pool.supplySideRevenue = pool.supplySideRevenue.plus(
    revenue.supplySideRevenue
  );
  pool.supplySideRevenueUsd = pool.supplySideRevenueUsd.plus(
    revenue.supplySideRevenueUsd
  );
  pool.totalRevenue = pool.totalRevenue
    .plus(pool.supplySideRevenue)
    .plus(pool.protocolRevenue);
  pool.totalRevenueUsd = pool.totalRevenueUsd
    .plus(pool.supplySideRevenueUsd)
    .plus(pool.protocolRevenueUsd);
  pool.save();
}

// using this implementation because .includes() fails in comparison
// and closures are not supported in AssemblyScript (so we can't use .some())
function hasStrategy(addresses: Address[], toFoundHex: string): bool {
  for (let i = 0, k = addresses.length; i < k; ++i) {
    let found = addresses[i].toHexString() == toFoundHex;
    if (found) {
      log.info('Address {} found in the list of strategies', [toFoundHex]);
      return true;
    }
  }
  log.info('Address {} not found in the list of strategies', [toFoundHex]);
  return false;
}

// This handler is called for every block for v3 Pools. It is used to persist
// totalSupply and totalDebt(), as there are no events for these methods
// and are restricted from thegraph to be hooked on.
export function handleBlockV3(_: ethereum.Block): void {
  let poolAddress = dataSource.address();
  let poolAddressHex = poolAddress.toHexString();
  log.info('Entered handleBlockV3 for address {}', [poolAddressHex]);
  let pool = getPool(poolAddressHex);
  let poolV3 = PoolV3.bind(poolAddress);
  log.info('Calculating values for pool {}', [poolAddressHex]);
  pool.totalSupply = poolV3.totalSupply();
  pool.totalSupplyUsd = toUsd(
    poolV3.totalSupply().toBigDecimal(),
    poolV3.decimals(),
    poolV3.token()
  );
  log.info('pool {}, totalSupply={}', [
    poolAddressHex,
    pool.totalSupply.toString(),
  ]);
  pool.totalDebt = poolV3.totalDebt();
  pool.totalDebtUsd = toUsd(
    poolV3.totalDebt().toBigDecimal(),
    poolV3.decimals(),
    poolV3.token()
  );
  log.info('pool {}, totalDebt={}', [
    poolAddressHex,
    pool.totalDebt.toString(),
  ]);
  pool.save();
}

// This handler is called for every block for v2 Pools. It is used to persist
// totalSupply and totalDebt(), as there are no events for these methods
// and are restricted from thegraph to be hooked on. totalDebt is calculated as the totalLocked() from the strategy
// associated to the v2 pool.
export function handleBlockV2(_: ethereum.Block): void {
  let poolAddress = dataSource.address();
  let poolAddressHex = poolAddress.toHexString();
  log.info('Entered handleBlockV2 for address {}', [poolAddressHex]);
  let pool = getPool(poolAddressHex);
  let poolV2 = PoolV2.bind(poolAddress);
  log.info('Calculating values for pool {}', [poolAddressHex]);
  pool.totalSupply = poolV2.totalSupply();
  pool.totalSupplyUsd = toUsd(
    poolV2.totalSupply().toBigDecimal(),
    poolV2.decimals(),
    poolV2.token()
  );
  log.info('pool {}, totalSupply={}', [
    poolAddressHex,
    pool.totalSupply.toString(),
  ]);
  // vVSP does not have total debt
  if (poolAddressHex != VVSPAddressHex) {
    let strategy = getStrategy(poolAddress);
    pool.totalDebt = strategy.totalLocked();
    pool.totalDebtUsd = toUsd(
      strategy.totalLocked().toBigDecimal(),
      poolV2.decimals(),
      poolV2.token()
    );
    log.info('pool {}, totalDebt={}', [
      poolAddressHex,
      pool.totalDebt.toString(),
    ]);
  }
  pool.save();
}

// This handler is used to calculate the withdraw fees for every pool
// The Withdraw event is fired in every withdraw, and the fees are calculated from pool.withdrawFee() if the address
// withdrawing is not whitelisted - in that case it is 0
// vVSP does not have withdraw fees either
function handleWithdrawFee(
  event: Withdraw,
  feeWhiteList: Address,
  withdrawFee: BigInt,
  decimals: i32,
  tokenValue: BigDecimal,
  tokenAddress: Address
): void {
  let poolAddress = dataSource.address();
  let poolAddressHex = poolAddress.toHexString();
  let withdrawerAddress = event.params.owner;
  let withdrawerAddressHex = withdrawerAddress.toHexString();
  let txHash = event.transaction.hash.toHexString();
  log.info(
    'Entered handleWithdrawFee for pool {}, withdraw made by {} in tx {}',
    [poolAddressHex, withdrawerAddressHex, txHash]
  );
  if (poolAddressHex === VVSPAddressHex) {
    log.info('Tx {}, Pool is vVSP, which has no fees.', [txHash]);
    return;
  }

  log.info('Getting the whitelist address for pool {}', [poolAddressHex]);
  let feeWhiteListAddressHex = feeWhiteList.toHexString();
  log.info('Fee address list for pool {} is {}', [
    poolAddressHex,
    feeWhiteListAddressHex,
  ]);
  if (feeWhiteListAddressHex !== ZeroAddressHex) {
    let addressList = AddressList.bind(feeWhiteList);
    if (addressList.contains(withdrawerAddress)) {
      log.info('Address {} is whitelisted in pool {}, withdraw is fee-less', [
        withdrawerAddressHex,
        poolAddressHex,
      ]);
      return;
    }
  }
  // the divisor value is 1e18, but I was unable to make it work with scientific notation
  let fees = event.params.shares
    .times(withdrawFee)
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'));
  log.info('Fees for tx {} in pool {} originated by withdraw from {} are {}', [
    txHash,
    poolAddressHex,
    withdrawerAddressHex,
    fees.toString(),
  ]);
  let revenue = calculateRevenue(fees, decimals, tokenValue, tokenAddress);
  log.info(
    'Fees distribution for tx {} in pool={}: ProtocolRevenue={}, supplySideRevenue={}',
    [
      txHash,
      poolAddressHex,
      revenue.protocolRevenue.toString(),
      revenue.supplySideRevenue.toString(),
    ]
  );
  saveRevenue(poolAddressHex, revenue);
  log.info('Leaving handleWithdraw for pool {}, withdraw made by {} in tx {}', [
    poolAddressHex,
    withdrawerAddressHex,
    txHash,
  ]);
}

// See handleWithdrawFee for explanation.
export function handleWithdrawFeeV2(event: Withdraw): void {
  let poolV2 = PoolV2.bind(dataSource.address());
  handleWithdrawFee(
    event,
    poolV2.feeWhiteList(),
    poolV2.withdrawFee(),
    poolV2.decimals(),
    poolV2.getPricePerShare().toBigDecimal(),
    poolV2.token()
  );
}

// See handleWithdrawFee for explanation.
export function handleWithdrawFeeV3(event: Withdraw): void {
  let poolV3 = PoolV3.bind(dataSource.address());
  handleWithdrawFee(
    event,
    poolV3.feeWhitelist(),
    poolV3.withdrawFee(),
    poolV3.decimals(),
    poolV3.totalValue().toBigDecimal().div(poolV3.totalSupply().toBigDecimal()),
    poolV3.token()
  );
}

// This handler hooks on the Deposit for V2 pools
// the shares are deposited in the underlying asset of the pool.
// if the depositor address is the strategy one, then we can ensure the deposited amount are the fees extracted from interest.
export function handleInterestFeeV2(event: Deposit): void {
  let poolAddress = dataSource.address();
  let poolAddressHex = poolAddress.toHexString();
  let txHash = event.transaction.hash.toHex();
  log.info('Entered handleInterestFeeV2 in tx={}, pool={}', [
    txHash,
    poolAddressHex,
  ]);
  let strategyAddress = getStrategyAddress(poolAddress);
  if (event.params.owner.toHexString() != strategyAddress.toHexString()) {
    log.info('Deposit in tx={} for pool={} from {} is not interest fees', [
      txHash,
      event.params.owner.toHexString(),
      poolAddressHex,
    ]);
    return;
  }
  let poolV2 = PoolV2.bind(dataSource.address());
  // the deposit is in collateral, not in shares, so there is no need for conversion
  let revenue = calculateRevenue(
    event.params.amount.toBigDecimal(),
    poolV2.decimals(),
    BigDecimal.fromString('1'),
    poolV2.token()
  );
  log.info(
    'Fees distribution for tx {} in pool{}: ProtocolRevenue={}, supplySideRevenue={}',
    [
      txHash,
      poolAddressHex,
      revenue.protocolRevenue.toString(),
      revenue.supplySideRevenue.toString(),
    ]
  );
  saveRevenue(poolAddressHex, revenue);
  log.info('Leaving handleDepositV2 for pool {}, in tx {}', [
    poolAddressHex,
    txHash,
  ]);
}

// This handler hooks on transferring of the fees for V3 Pools
// Strategies of the pool transfer the fees to the pool as an amount of shares
// this is done through minting of the shares, hence the Transfer event is emitted.
export function handleInterestFeeV3(event: Transfer): void {
  let poolAddress = dataSource.address();
  let poolAddressHex = poolAddress.toHexString();
  log.info('Entered handleInterestFeeV3 in tx={}, pool={}', [
    event.transaction.hash.toHex(),
    poolAddressHex,
  ]);
  let fromHex = event.params.from.toHexString();
  let toHex = event.params.to.toHexString();
  let poolV3 = PoolV3.bind(poolAddress);
  if (
    fromHex != ZeroAddressHex ||
    !hasStrategy(poolV3.getStrategies(), toHex)
  ) {
    log.info(
      'Transfer Event for pool V3 {} was made by {} - it is not interest fees.',
      [poolAddressHex, toHex]
    );
    return;
  }
  let interestFees = event.params.value
    .times(poolV3.pricePerShare())
    .toBigDecimal()
    .div(BigDecimal.fromString('1000000000000000000'));
  log.info('interestFees={}', [interestFees.toString()]);
  let revenue = calculateRevenue(
    interestFees,
    poolV3.decimals(),
    poolV3.totalValue().toBigDecimal().div(poolV3.totalSupply().toBigDecimal()),
    poolV3.token()
  );
  log.info(
    'Interest fees distribution for tx {} in poolV3 {}: ProtocolRevenue={}, supplySideRevenue={}',
    [
      event.transaction.hash.toHexString(),
      poolAddressHex,
      revenue.protocolRevenue.toString(),
      revenue.supplySideRevenue.toString(),
    ]
  );
  saveRevenue(poolAddressHex, revenue);
}
