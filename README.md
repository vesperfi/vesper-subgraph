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
  pools (id: "pool-id") {
    id,
    totalSupply,
    totalDebt,
    protocolRevenue,
    supplySideRevenue
  }
}

- `id`: Address of the pool.
- `totalSupply`: Value of the assets deposited in the pool.
- `totalDebt`: Value of the assets invested from the pool
- `protocolRevenue`: For Withdraws, it is 95% of the `withdrawFee`. For interest yield, it is the 95% of the interest fee. Measured in the underlying collateral asset.
- `supplySideRevenue`: For Withdraws, it is 5% of the `withdrawFee`. For interest yield, it is the 5% of the interest fee. Measured in the underlying collateral asset.

In addition to these metrics, all of them have their conterpart measured in USD
```
