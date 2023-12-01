# relayer-cli
a simple and slightly colorful CLI demo for interacting with the sequence relayer in order to mint tokens, buy skyweaver cards, check balance, & send coin to friends.

## how to use
```
$ pnpm sequence:demo wallet
Your wallet address: <address>

$ pnpm sequence:demo claim
...

$ pnpm sequence:demo purchase-collectible skyweaver
...

$ pnpm sequence:demo balance
$DEMO balance: 32

$ pnpm sequence:demo balance skyweaver
┌──────────┬──────────────────────────────┬──────────┐
│ Token ID │ Name                         │ Balance  │
├──────────┼──────────────────────────────┼──────────┤
│ 67672    │ Air Wisp (Silver)            │ 100      │
└──────────┴──────────────────────────────┴──────────┘

$ pnpm sequence:demo send 8 <address>
...
```