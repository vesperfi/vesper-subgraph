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
import { Erc20Token } from '../types/Erc20Token';
import { Pool } from '../types/schema';
import {
  toUsd,
  getStrategy,
  getStrategyAddress,
  hasStrategy,
  getShareToTokenRateV2,
  getShareToTokenRateV3,
  getDecimalDivisor,
} from './utils';

const VVSPAddressHex = '0xbA4cFE5741b357FA371b506e5db0774aBFeCf8Fc';
const ZeroAddressHex = '0x0000000000000000000000000000000000000000';
let VVSPAddress = Address.fromHexString(VVSPAddressHex);
let ZeroAddress = Address.fromHexString(ZeroAddressHex);

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
  newPool.totalDebtUsd = zeroString;
  newPool.totalSupply = BigInt.fromString('0');
  newPool.totalSupplyUsd = zeroString;
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
    shareToTokenRate: BigDecimal,
    tokenAddress: Address
  ) {
    let tokenDecimals = Erc20Token.bind(tokenAddress).decimals();
    let protocolRevenue = _protocolRevenue.times(shareToTokenRate);
    this.protocolRevenue = protocolRevenue;
    this.protocolRevenueUsd = toUsd(
      protocolRevenue,
      tokenDecimals,
      tokenAddress
    );
    let supplySideRevenue = _supplySideRevenue.times(shareToTokenRate);
    this.supplySideRevenue = supplySideRevenue;
    this.supplySideRevenueUsd = toUsd(
      supplySideRevenue,
      tokenDecimals,
      tokenAddress
    );
  }
}

function calculateRevenue(
  interest: BigDecimal,
  shareToTokenRate: BigDecimal,
  tokenAddress: Address
): Revenue {
  // 95% of the fees go to the protocol revenue
  let protocolRevenue = interest.times(BigDecimal.fromString('0.95'));
  // 5% of the fees go to the supply-side revenue
  let supplySideRevenue = interest.times(BigDecimal.fromString('0.05'));
  return new Revenue(
    protocolRevenue,
    supplySideRevenue,
    shareToTokenRate,
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
  let totalSupplyCall = poolV3.try_totalSupply();
  if (!totalSupplyCall.reverted) {
    pool.totalSupply = totalSupplyCall.value;
    pool.totalSupplyUsd = toUsd(
      pool.totalSupply.toBigDecimal(),
      poolV3.decimals(),
      poolV3.token()
    );
  }
  log.info('pool {}, totalSupply={}', [
    poolAddressHex,
    pool.totalSupply.toString(),
  ]);
  let totalDebtCall = poolV3.try_totalDebt();
  if (!totalDebtCall.reverted) {
    pool.totalDebt = totalDebtCall.value;
    pool.totalDebtUsd = toUsd(
      pool.totalDebt.toBigDecimal(),
      poolV3.decimals(),
      poolV3.token()
    );
  }
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
  let totalSupplyCall = poolV2.try_totalSupply();
  if (!totalSupplyCall.reverted) {
    pool.totalSupply = totalSupplyCall.value;
    pool.totalSupplyUsd = toUsd(
      pool.totalSupply.toBigDecimal(),
      poolV2.decimals(),
      poolV2.token()
    );
  }
  log.info('pool {}, totalSupply={}', [
    poolAddressHex,
    pool.totalSupply.toString(),
  ]);
  // vVSP does not have total debt
  if (poolAddress != VVSPAddress) {
    let strategy = getStrategy(poolAddress);
    let totalLockedCall = strategy.try_totalLocked();
    if (!totalLockedCall.reverted) {
      pool.totalDebt = totalLockedCall.value;
      pool.totalDebtUsd = toUsd(
        pool.totalDebt.toBigDecimal(),
        poolV2.decimals(),
        poolV2.token()
      );
    }
    log.info('pool {}, totalDebt={}', [
      poolAddressHex,
      pool.totalDebt.toString(),
    ]);
  }
  pool.save();
}

// This handler is used to calculate the withdraw fees for every pool
// The Withdraw event is fired in every withdraw, and the fees are calculated if the address
// withdrawing is not whitelisted - in that case it is 0
// vVSP does not have withdraw fees either
function handleWithdrawFee(
  event: Withdraw,
  feeWhiteList: Address,
  withdrawFee: BigDecimal,
  shareToTokenRate: BigDecimal,
  tokenAddress: Address,
  vTokenDecimals: i32
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
  if (feeWhiteList != ZeroAddress) {
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
    .toBigDecimal()
    .div(getDecimalDivisor(vTokenDecimals))
    .times(withdrawFee);
  log.info('Fees for tx {} in pool {} originated by withdraw from {} are {}', [
    txHash,
    poolAddressHex,
    withdrawerAddressHex,
    fees.toString(),
  ]);
  let revenue = calculateRevenue(fees, shareToTokenRate, tokenAddress);
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
    poolV2
      .withdrawFee()
      .toBigDecimal()
      .div(BigDecimal.fromString('1000000000000000000')),
    getShareToTokenRateV2(poolV2),
    poolV2.token(),
    poolV2.decimals()
  );
}

// See handleWithdrawFee for explanation.
export function handleWithdrawFeeV3(event: Withdraw): void {
  let poolV3 = PoolV3.bind(dataSource.address());
  handleWithdrawFee(
    event,
    poolV3.feeWhitelist(),
    poolV3.withdrawFee().toBigDecimal().div(BigDecimal.fromString('10000')),
    getShareToTokenRateV3(poolV3),
    poolV3.token(),
    poolV3.decimals()
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
  if (event.params.owner != strategyAddress) {
    log.info('Deposit in tx={} for pool={} from {} is not interest fees', [
      txHash,
      event.params.owner.toHexString(),
      poolAddressHex,
    ]);
    return;
  }
  let poolV2 = PoolV2.bind(dataSource.address());
  let erc20Token = Erc20Token.bind(poolV2.token());
  let revenue = calculateRevenue(
    event.params.amount
      .toBigDecimal()
      .div(getDecimalDivisor(erc20Token.decimals())),
    BigDecimal.fromString('1'), // the deposit is in collateral, not in shares, so there is no need for conversion
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
  let poolV3 = PoolV3.bind(poolAddress);
  if (
    event.params.from != ZeroAddress ||
    !hasStrategy(poolV3.getStrategies(), event.params.to)
  ) {
    let toHex = event.params.to.toHexString();
    log.info(
      'Transfer Event for pool V3 {} was made by {} - it is not interest fees.',
      [poolAddressHex, toHex]
    );
    return;
  }
  let interestFees = event.params.value
    .toBigDecimal()
    .div(getDecimalDivisor(poolV3.decimals()));
  log.info('interestFees={}', [interestFees.toString()]);
  let revenue = calculateRevenue(
    interestFees,
    getShareToTokenRateV3(poolV3),
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
