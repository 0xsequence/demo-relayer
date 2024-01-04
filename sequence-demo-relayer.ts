import path, { dirname } from 'path'
import { fileURLToPath } from 'url'

import { Session } from '@0xsequence/auth'
import { GoogleKmsSigner } from '@0xsequence/google-kms-signer'
import { SequenceIndexerClient } from '@0xsequence/indexer'
import { ChainId } from '@0xsequence/network'
import axios from 'axios'
import chalk from 'chalk'
import { Command } from 'commander'
import dotenv from 'dotenv'
import { ethers } from 'ethers'
import fs from 'fs-extra'
import inquirer from 'inquirer'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const program = new Command()
const indexer = new SequenceIndexerClient('https://polygon-indexer.sequence.app')
const contractAddress = '0x4574ca5b8b16d8e36d26c7e3dbeffe81f6f031f7'
const providerUrl = 'https://nodes.sequence.app/polygon'
const scanner = 'https://polygonscan.com'
const CHAIN_ID = ChainId.POLYGON
const API_KEY = 'bec3622f-3f4a-4f49-8f62-1bb0e16d0da6' // Replace with your API key, sh

const GOOGLE_KMS_SETTINGS = [
  'GOOGLE_KMS_PROJECT',
  'GOOGLE_KMS_LOCATION',
  'GOOGLE_KMS_KEY_RING',
  'GOOGLE_KMS_CRYPTO_KEY',
  'GOOGLE_KMS_CRYPTO_KEY_VERSION'
]

async function getSigner(provider?: ethers.providers.Provider): Promise<ethers.Signer> {
  const envFilePath = path.join(__dirname, '.env')

  // Check if .env file exists
  if (fs.existsSync(envFilePath)) {
    dotenv.config()

    // Check if Google KMS settings exist
    if (GOOGLE_KMS_SETTINGS.some(setting => process.env[setting])) {
      if (!GOOGLE_KMS_SETTINGS.every(setting => process.env[setting])) {
        console.warn(`To use a Google KMS key for signing, specify all options ${GOOGLE_KMS_SETTINGS.join(', ')}`)
      } else {
        return new GoogleKmsSigner(
          {
            project: process.env.GOOGLE_KMS_PROJECT!,
            location: process.env.GOOGLE_KMS_LOCATION!,
            keyRing: process.env.GOOGLE_KMS_KEY_RING!,
            cryptoKey: process.env.GOOGLE_KMS_CRYPTO_KEY!,
            cryptoKeyVersion: process.env.GOOGLE_KMS_CRYPTO_KEY_VERSION!
          },
          undefined,
          provider
        )
      }
    }

    // Check if pkey exists in .env
    if (process.env.pkey) {
      console.log('Private key already exists in .env file.')
      return new ethers.Wallet(process.env.pkey, provider)
    }
  }

  // If not, generate a new wallet and private key
  const wallet = ethers.Wallet.createRandom()
  const privateKey = wallet.privateKey

  // Write private key to .env file
  fs.appendFileSync(envFilePath, `pkey=${privateKey}\n`)
  console.log('Generated and saved a new private key to .env file.')

  return new ethers.Wallet(privateKey, provider)
}

async function fetchPriceCoinMarketCap(currency: string) {
  const headers = {
    'X-CMC_PRO_API_KEY': API_KEY,
    Accept: 'application/json'
  }

  try {
    const response = await axios.get('https://pro-api.coinmarketcap.com/v1/cryptocurrency/listings/latest', { headers: headers })
    const token = response.data.data.find((coin: any) => coin.symbol === currency)

    if (token) {
      return token.quote.USD.price
    } else {
      console.log(`${currency} not found in response`)
    }
  } catch (error) {
    console.error(`Error fetching Matic ${currency} price from CoinMarketCap:`, error)
  }
}

program
  .name('sequence-demo-relayer')
  .description(
    chalk.blue(
      'CLI to claim and send ERC20 tokens called $DEMO.\n' +
        '\n' +
        ' _____                             \n' +
        '|   __|___ ___ _ _ ___ ___ ___ ___ \n' +
        '|__   | -_| . | | | -_|   |  _| -_|\n' +
        '|_____|___|_  |___|___|_|_|___|___|\n' +
        '            |_|                    \n'
    )
  )
  .version('0.0.1')

program
  .command('wallet')
  .description('generate a wallet, if not created locally and print wallet address')
  .action(async () => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(providerUrl)

      // Create your server EOA
      const walletEOA = await getSigner(provider)

      // Open a Sequence session, this will find or create
      // a Sequence wallet controlled by your server EOA
      const session = await Session.singleSigner({
        signer: walletEOA
      })

      const signer = session.account.getSigner(CHAIN_ID)

      console.log(chalk.blue(`Your wallet address: ${signer.account.address}`))
    } catch (error) {
      console.error(`Failed to generate or load private key: ${error}`)
    }
  })

program
  .command('claim')
  .description('claim some $DEMO token from the faucet')
  .action(async () => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(providerUrl)

      // Create your server EOA
      const walletEOA = await getSigner(provider)

      // Open a Sequence session, this will find or create
      // a Sequence wallet controlled by your server EOA
      const session = await Session.singleSigner({
        signer: walletEOA
      })

      const signer = session.account.getSigner(CHAIN_ID, {
        // OPTIONAL: You can also enforce a specific way to pay for gas fees
        // if not provided the sdk will select one for you
        selectFee: async (_txs: any, options: any[]) => {
          // Find the option to pay with native tokens
          const found = options[0]

          const polygonPriceInUSD = await fetchPriceCoinMarketCap('MATIC')

          // Convert gas price from Gwei to ETH
          const computeValue = found.value / 1e18

          // Convert that USD value to MATIC
          const maticValue = computeValue * polygonPriceInUSD

          const answers = await inquirer.prompt([
            {
              type: 'input',
              name: 'userInput',
              message: chalk.greenBright(
                `Your tx will cost ${computeValue.toFixed(8).toString()} in MATIC ($${maticValue.toFixed(
                  8
                )} USD), would you like to proceed y/n`
              )
            }
          ])

          // After getting user input, continue with the function
          if (answers.userInput == 'y') {
            return undefined
          } else {
            console.log(chalk.red(`User denied tx.`))
            throw Error('User denied transaction')
          }
        }
      })

      const demoCoinInterface = new ethers.utils.Interface(['function mint()'])

      const data = demoCoinInterface.encodeFunctionData('mint', [])

      const txn = {
        to: contractAddress,
        data
      }

      const res = await signer.sendTransaction(txn, { simulateForFeeOptions: true })
      console.log(`Transaction ID: ${res.hash}`)
      console.log(`URL of Tx: ${scanner}/tx/${res.hash}`)
      const receipt = await provider.getTransactionReceipt(res.hash)

      const polygonPriceInUSD = await fetchPriceCoinMarketCap('MATIC')

      const totalCostInWei = receipt.gasUsed
      const gasPriceInUSD = (Number(totalCostInWei) * polygonPriceInUSD) / 1e9

      console.log(chalk.blackBright(`gas used: ${totalCostInWei} wei ($${gasPriceInUSD.toFixed(8)} USD)`))
      console.log(chalk.cyan(`8 $DEMO coin was transferred to ${signer.account.address}`))
    } catch (error) {
      console.error(error)
    }
  })

program
  .command('balance')
  .description('get the user balance of $DEMO coin')
  .action(async () => {
    const provider = new ethers.providers.JsonRpcProvider(providerUrl)

    // Create your server EOA
    const walletEOA = await getSigner(provider)

    // Open a Sequence session, this will find or create
    // a Sequence wallet controlled by your server EOA
    const session = await Session.singleSigner({
      signer: walletEOA
    })

    const signer = session.account.getSigner(CHAIN_ID)
    const accountAddress = signer.account.address

    const balance = await indexer.getTokenBalances({
      contractAddress: contractAddress,
      accountAddress: accountAddress,
      includeMetadata: true
    })

    balance.balances.map((token: any) => {
      if (token.contractAddress == contractAddress) {
        console.log(chalk.cyan(`$DEMO balance: ${token.balance}`))
      }
    })
  })

program
  .command('send')
  .description('send a certain number of tokens to a friends address')
  .argument('<amount>', 'amount to send')
  .argument('<address>', 'wallet address to send to')
  .action(async (amount, address) => {
    try {
      const provider = new ethers.providers.JsonRpcProvider(providerUrl)

      // Create your server EOA
      const walletEOA = await getSigner(provider)

      // Open a Sequence session, this will find or create
      // a Sequence wallet controlled by your server EOA
      const session = await Session.singleSigner({
        signer: walletEOA
      })

      const signer = session.account.getSigner(CHAIN_ID)

      const erc20Interface = new ethers.utils.Interface(['function transfer(address to, uint256 value) public returns (bool)'])

      const data = erc20Interface.encodeFunctionData('transfer', [address, amount])

      const txn = {
        to: contractAddress,
        data
      }

      try {
        const res = await signer.sendTransaction(txn)
        console.log(`Transaction ID: ${res.hash}`)
        console.log(`URL of Tx: ${scanner}/tx/${res.hash}`)
      } catch (err) {
        console.log(`Something went wrong, check your inputs`)
        console.log(err)
      }
    } catch (error) {
      console.error(`Failed to generate or load private key: ${error}`)
    }
  })

program.parse()
