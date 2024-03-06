# marmalade-ng-sweep-bot

Bot for test/example purpose only.

Terminate/withdraw sales on Marmalade-NG

## Action

**Fixed sales:** Withdraw timed out sales.

**Dutch auction sales:** Withdraw timed out sales.

**Auction sales:**
- Withdraw timed out sales with no bid.
- Terminates timed out sales with at least one bid.


## Configuration

All configuration variables resides in `config.yaml`

## Running

 ```
 yarn install
 yarn run bot
 ```

## Alternate Config file

It's possible to use another configuration file (other than `config.yaml`) by adding it to the command line

```
yarn run bot alternate_config.yaml
```
