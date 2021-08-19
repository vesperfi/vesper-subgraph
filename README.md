# Vesper Subgraph

## Setup

### Prerequisites

- Docker
- Node v14

### Steps

- Download the `graph-node` repo in a separated folder

```
git clone https://github.com/graphprotocol/graph-node/
```

- Run the following command in the `docker` folder if the OS is linux:

```sh
cd graph-node/docker
# only for linux
./setup.sh
```

- The `ethereum` variable needs to be updated to set the network and the node url. Update in `docker-compose.yml` in the line 20 with the following pattern:

```yml
# pattern is ethereum: <network-name>:<url>
ethereum: mainnet:https://some-url:8545
```

**Notes**

- The node url **must** support batch requests.
- If another network is used (like `rinkeby`), the `subgraph-generator.js` must be updated. The names in the `docker-compose.yml` and the generated `subgraph.yml` must be the same.

- Start the docker container

```
docker-compose up
```

- Go back to this repo folder. To install the dependencies, run

```
npm run ci
```

- Run the following command which will generate then `subgraph.yml`, the types files and then deploy the subgraph locally. You may be prompted a label version.

```
npm run bootstrap
```

- After that, the docker container should start syncing for each pool.

Open http://127.0.0.1:8000/subgraphs/name/bloqpriv/vesper-subgraph/graphql and use GraphQL to query the data.

## Query Model

Checkout the [Vesper Revenue Model](https://docs.vesper.finance/vsp-economics/revenue-model).  
This is an example query:

```graphql
{
  pools(id: "pool-id") {
    id
    totalSupply
    totalDebt
    protocolRevenue
    supplySideRevenue
  }
}
```

- `id`: Address of the pool.
- `totalSupply`: Value of the assets deposited in the pool. Measured in pool tokens.
- `totalDebt`: Value of the assets invested from the pool. Measured in the collateral token.
- `protocolRevenue`: For Withdraws, it is 95% of the `withdrawFee`. For interest yield, it is the 95% of the interest fee. Measured in the underlying collateral asset.
- `supplySideRevenue`: For Withdraws, it is 5% of the `withdrawFee`. For interest yield, it is the 5% of the interest fee. Measured in the underlying collateral asset.
- `totalRevenue`: `protocolRevenue` plus `supplySideRevenue`

In addition to these metrics, all of them have their conterpart measured in USD (`protocolRevenueUsd`, `supplySideRevenueUsd` and so on).

## Deployment

### Testing deploy in Graph Studio.

Go to [Graph Studio](https://thegraph.com/studio/) and connect a wallet. Then, the following commands must be run.

```sh
# The deployment id can be copied from the Details tab
# This is only required once
./node_modules/.bin/graph auth  --studio <deployment-id>
# make sure the latest version of the generated files is correct
npm run bootstrap && npm run build
# push to graph studio
./node_modules/.bin/graph deploy --studio vesper-subgraph-test -l <VERSION>
```

`<VERSION>` follows a semantic versioning schema and must be incremented on each deploy.

Further information on the steps here [here](https://thegraph.com/docs/developer/deploy-subgraph-studio).

### Troubleshooting errors in Graph Studio

Follow these steps to query the state of the subgraph if it fails even before logging.

1. Go to [graphiql-online](https://graphiql-online.com/).
1. Enter API `https://api.thegraph.com/index-node/graphql`
1. Get your Deployment ID - you will find it in the Details section in Graph Studio (keep in mind it changes on every deployment)
1. Run the following query, replacing the `<DEPLOYMENT-ID>`

```graphql
{
  indexingStatuses(subgraphs: ["<DEPLOYMENT-ID>"]) {
    subgraph
    synced
    health
    entityCount
    fatalError {
      handler
      message
      deterministic
      block {
        hash
        number
      }
    }
    chains {
      chainHeadBlock {
        number
      }
      earliestBlock {
        number
      }
      latestBlock {
        number
      }
    }
  }
}
```
