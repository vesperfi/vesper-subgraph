const pTap = require('p-tap');
const { pools } = require('vesper-metadata');
const { writeFile, rmdir, mkdir, pathExists, copy } = require('fs-extra');
const { exec } = require('child_process');

const TypesFolder = './types';
const GeneratedCodeFolder = './generated';

const poolsToWatch = pools.filter(
  (pool) => pool.chainId === 1 && pool.stage === 'prod'
);

const getPoolVersion = ({ version = 2 }) => version;

const addInterestFeeEvent = function (pool) {
  if (getPoolVersion(pool) === 2) {
    return '- event: Deposit(indexed address,uint256,uint256)';
  }
  return '- event: Transfer(indexed address,indexed address,uint256)';
};

const dataSources = poolsToWatch.map((pool) => {
  const version = getPoolVersion(pool);
  return `  - kind: ethereum/contract
    name: 'poolV${version}_${pool.name}_${pool.address}'
    network: mainnet
    source:
      address: '${pool.address}'
      abi: PoolV${version}
      startBlock: ${pool.birthblock}
    mapping:
      kind: ethereum/events
      apiVersion: 0.0.4
      language: wasm/assemblyscript
      file: ./src/mappings.ts
      entities:
        - PoolQuery
      # This lists all posible abis to be used for each data source
      abis:
        - name: PoolV${version}
          file: ./abis/pool-v${version}.json
        - name: AddressList
          file: ./abis/address-list.json
        ${
          version === 2
            ? `- name: StrategyV2
          file: ./abis/strategy-v2.json
        - name: Controller
          file: ./abis/controller.json
        `
            : ''
        }
        - name: PriceRouter
          file: ./abis/uniswap.json
        - name: Erc20Token
          file: ./abis/erc-20.json
      # this is used to calculate withdraw fees
      eventHandlers:
        - event: Withdraw(indexed address,uint256,uint256)
          handler: handleWithdrawFeeV${version}
      # this is used to calculate interest fees
        ${addInterestFeeEvent(pool)}
          handler: handleInterestFeeV${version}
      # this is used to calculate totalDebt and totalSupply values
      blockHandlers:
        - handler: handleBlockV${version}
    `;
});

const yaml = `specVersion: 0.0.2
description: Vesper subgraph.
repository: https://https://github.com/bloqpriv/vesper-subgraph
schema:
  file: ./schema.graphql
dataSources:
${dataSources.join('\n')}`;

function promisifyChildProcess(fn) {
  return function (...args) {
    const child = fn(...args);
    // forward the output of the child process to the parent one
    child.stdout.pipe(process.stdout);
    child.stderr.pipe(process.stderr);
    return new Promise(function (resolve, reject) {
      child.addListener('error', reject);
      child.addListener('exit', resolve);
    });
  };
}

async function copyGeneratedFiles(pool) {
  if (!pool) {
    return;
  }
  const folderName = `${GeneratedCodeFolder}/poolV${getPoolVersion(pool)}_${
    pool.name
  }_${pool.address}`;
  return copy(folderName, TypesFolder, { overwrite: true }).then(
    pTap(() =>
      console.log(`Copied classes for V${getPoolVersion(pool)} pools.`)
    )
  );
}

// node-graph generates a class for each pool, but we just need a class for v2 and v3 pools (so far)
function cleanUpdatedFiles() {
  return pathExists(TypesFolder)
    .then(
      pTap((exists) =>
        console.log(`Types folder ${exists ? '' : 'does not '}exists`)
      )
    )
    .then((exists) =>
      exists ? rmdir(TypesFolder, { recursive: true }) : Promise.resolve()
    )
    .then(pTap(() => console.log('Starting to run codegen.')))
    .then(() => promisifyChildProcess(exec)('npm run codegen'))
    .then(
      pTap(() =>
        console.log(
          'Generation of classes and schema succeded! Proceeding now to clean up the generated files.'
        )
      )
    )
    .then(() => mkdir(TypesFolder))
    .then(pTap(() => console.log('Types folder created!')))
    .then(function () {
      // take a v2 pool, a v3pool, calculate the folder name and move the files into ./types
      const v2Pool = poolsToWatch.find(({ version = 2 }) => version === 2);
      const v3Pool = poolsToWatch.find(({ version }) => version === 3);
      return Promise.all([
        copyGeneratedFiles(v2Pool),
        copyGeneratedFiles(v3Pool),
        copy(`${GeneratedCodeFolder}/schema.ts`, `${TypesFolder}/schema.ts`, {
          overwrite: true,
        }),
      ]);
    })
    .then(() => rmdir(GeneratedCodeFolder, { recursive: true }));
}

writeFile('./subgraph.yaml', yaml)
  .then(pTap(() => console.log('subgraph.yaml generated successfully')))
  .then(cleanUpdatedFiles)
  .then(pTap(() => console.log('All file and code generation succeeded!')))
  .catch((e) => console.error(e));
