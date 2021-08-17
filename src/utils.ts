import { Address, BigDecimal, BigInt, log } from '@graphprotocol/graph-ts';
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

const ControllerAddress = '0xa4F1671d3Aee73C05b552d57f2d16d3cfcBd0217';

function getUsdPriceRate(decimals: i32, address: Address): BigInt {
  let priceRouter = PriceRouter.bind(RouterAddress);
  // Interpolation with ``not supported by AssemblyScript
  let oneUnit = BigInt.fromString('1'.concat('0'.repeat(decimals)));
  log.info('Trying to retrieve USDC rate for address {} with decimals={}', [
    address.toHexString(),
    decimals.toString(),
  ]);
  // the second parameter returns the rate
  return priceRouter.getAmountsOut(oneUnit, [address, UsdcAddress])[1];
}

export function toUsd(
  amountIn: BigDecimal,
  decimals: i32,
  tokenAddress: Address
): BigDecimal {
  let usdRate = getUsdPriceRate(decimals, tokenAddress);
  log.info('USDC rate for address={} is {}', [
    tokenAddress.toHexString(),
    usdRate.toString(),
  ]);
  return amountIn.times(usdRate.toBigDecimal());
}

export function getStrategyAddress(poolAddress: Address): Address {
  let controller = Controller.bind(Address.fromString(ControllerAddress));
  return controller.strategy(poolAddress);
}

export function getStrategy(poolAddress: Address): StrategyV2 {
  let strategyAddress = getStrategyAddress(poolAddress);
  return StrategyV2.bind(strategyAddress);
}
