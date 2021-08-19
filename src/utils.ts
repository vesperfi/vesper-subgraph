import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts';
import { PoolV2 } from '../types/PoolV2';
import { PoolV3 } from '../types/PoolV3';
import { Controller } from '../types/Controller';
import { StrategyV2 } from '../types/StrategyV2';
import { PriceRouter } from '../types/PriceRouter';

// This is using Sushiswap address for Ethereum Mainnet.
let RouterAddress = Address.fromString(
  '0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D'
);
let UsdcAddress = Address.fromString(
  '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
);

let WEthAddress = Address.fromString(
  '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
);

const ControllerAddress = '0xa4F1671d3Aee73C05b552d57f2d16d3cfcBd0217';

export function getDecimalDivisor(decimals: i32): BigDecimal {
  return BigDecimal.fromString('1'.concat('0'.repeat(decimals)));
}

function getUsdPriceRate(decimals: i32, address: Address): BigDecimal {
  let priceRouter = PriceRouter.bind(RouterAddress);
  // Interpolation with ``not supported by AssemblyScript
  let oneUnit = BigInt.fromString('1'.concat('0'.repeat(decimals)));
  // the second parameter returns the rate
  let paths: Address[] = [address];
  if (address != WEthAddress) {
    paths.push(WEthAddress);
  }
  paths.push(UsdcAddress);
  log.info('Trying to retrieve USDC rate for address {} with decimals={}.', [
    address.toHexString(),
    decimals.toString(),
  ]);
  let ratesCall = priceRouter.try_getAmountsOut(oneUnit, paths);
  if (ratesCall.reverted) {
    log.error('failed to retrieve usdc rate for address {}', [
      address.toHexString(),
    ]);
    return BigDecimal.fromString('1');
  }
  // divide by one unit of USDC
  return ratesCall.value.pop().toBigDecimal().div(getDecimalDivisor(6));
}

export function toUsd(
  amountIn: BigDecimal,
  decimals: i32,
  tokenAddress: Address
): BigDecimal {
  if (tokenAddress == UsdcAddress) {
    return amountIn;
  }
  let usdRate = getUsdPriceRate(decimals, tokenAddress);
  log.info('USDC rate for address={} is {}', [
    tokenAddress.toHexString(),
    usdRate.toString(),
  ]);
  return amountIn.times(usdRate);
}

export function getStrategyAddress(poolAddress: Address): Address {
  let controller = Controller.bind(Address.fromString(ControllerAddress));
  return controller.strategy(poolAddress);
}

export function getStrategy(poolAddress: Address): StrategyV2 {
  let strategyAddress = getStrategyAddress(poolAddress);
  return StrategyV2.bind(strategyAddress);
}

// using this implementation because .includes() fails in comparison
// and closures are not supported in AssemblyScript (so we can't use .some())
export function hasStrategy(addresses: Address[], toFound: Address): bool {
  for (let i = 0, k = addresses.length; i < k; ++i) {
    let found = addresses[i] == toFound;
    if (found) {
      log.info('Address {} found in the list of strategies', [
        toFound.toHexString(),
      ]);
      return true;
    }
  }
  log.info('Address {} not found in the list of strategies', [
    toFound.toHexString(),
  ]);
  return false;
}

export function getShareToTokenRateV2(pool: PoolV2): BigDecimal {
  return pool
    .getPricePerShare()
    .toBigDecimal()
    .div(getDecimalDivisor(pool.decimals()));
}

export function getShareToTokenRateV3(pool: PoolV3): BigDecimal {
  return pool
    .pricePerShare()
    .toBigDecimal()
    .div(getDecimalDivisor(pool.decimals()));
}
