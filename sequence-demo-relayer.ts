import fs from 'fs-extra';
import path from 'path';
import dotenv from 'dotenv';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

import { Session, SessionSettingsDefault } from '@0xsequence/auth'
import { ChainId } from '@0xsequence/network'
import { Command } from 'commander'
import inquirer from 'inquirer';
import chalk from 'chalk';
import { ethers } from 'ethers';
import axios from 'axios'

const program = new Command();

import { SequenceIndexerClient } from '@0xsequence/indexer'

const indexer = new SequenceIndexerClient('https://arbitrum-goerli-indexer.sequence.app')
const contractAddress = '0x86677e53c78dd0d32aa955c3312212a2d2ea83fb'
const CHAIN_ID = ChainId.ARBITRUM_GOERLI

async function generateOrLoadPrivateKey() {
    const envFilePath = path.join(__dirname, '.env');

    // Check if .env file exists
    if (fs.existsSync(envFilePath)) {
        dotenv.config();

        // Check if pkey exists in .env
        if (process.env.pkey) {
            console.log('Private key already exists in .env file.');
            return process.env.pkey;
        }
    }

    // If not, generate a new wallet and private key
    const wallet = ethers.Wallet.createRandom();
    const privateKey = wallet.privateKey;

    // Write private key to .env file
    fs.appendFileSync(envFilePath, `pkey=${privateKey}\n`);
    console.log('Generated and saved a new private key to .env file.');

    return privateKey;
}

program
    .name('sequence-demo-relayer')
    .description(chalk.blue('CLI to claim and send ERC20 tokens called $DEMO.\n\n _____                             \n|   __|___ ___ _ _ ___ ___ ___ ___ \n|__   | -_| . | | | -_|   |  _| -_|\n|_____|___|_  |___|___|_|_|___|___|\n            |_|\n '))
    .version('0.0.1');

program.command('wallet')
    .description('generate a wallet, if not created locally and print wallet address')
    .action((str: any, options: any) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const providerUrl = 'https://nodes.sequence.app/arbitrum-goerli';
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA,
            })
            
            const signer = session.account.getSigner(CHAIN_ID)

            console.log(chalk.blue(`Your wallet address: ${signer.account.address}`))
        }).catch(error => {
            console.error(`Failed to generate or load private key: ${error}`);
        });
    });

program.command('claim')
    .description('claim some $DEMO token from the faucet')
    .action(async (str: any, options: any) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const providerUrl = 'https://nodes.sequence.app/arbitrum-goerli';
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA
            })
            
            const signer = session.account.getSigner(CHAIN_ID,
                {
                // OPTIONAL: You can also enforce a specific way to pay for gas fees
                // if not provided the sdk will select one for you
                selectFee: async (
                  _txs: any,
                  options: any[]
                ) => {

                    // Find the option to pay with native tokens
                    const found = options[0]
                    const gwei = found.value / 1e9;
                    const ethPriceResponse = await axios.get('https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd');
                    const ethPriceInUSD = ethPriceResponse.data.ethereum.usd;

                    // Convert gas price from Gwei to USD
                    const gasPriceInUSD = gwei * ethPriceInUSD / 1e9; // divide by 1e9 to convert Gwei to ETH

                    const answers = await inquirer.prompt([
                        {
                            type: 'input',
                            name: 'userInput',
                            message: chalk.greenBright(`Your tx will cost ~${(gwei.toFixed(2)).toString()} in gwei ($${gasPriceInUSD.toFixed(2)} USD), would you like to proceed y/n`),
                        }
                    ]);
            
                    // After getting user input, continue with the function
                    if(answers.userInput == 'y'){
                        return undefined
                    } else {
                        console.log(chalk.red(`User denied tx.`))
                        throw Error('User denied transaction')
                    }
                }
              })

            const demoCoinInterface = new ethers.utils.Interface([
                'function mint()'
            ])
                
            const data = demoCoinInterface.encodeFunctionData(
                'mint', []
            )
                
            const txn = {
                to: contractAddress,
                data
            }

            const res = await signer.sendTransaction(txn, {simulateForFeeOptions: true})
            console.log(`Transaction ID: ${res.hash}`)
            console.log(`URL of Tx: https://goerli.arbiscan.io/tx/${res.hash}`)
            const receipt = await provider.getTransactionReceipt(res.hash);
            console.log(chalk.blackBright(`gas used: ${receipt.gasUsed.toString()}`));
            console.log(chalk.cyan(`8 $DEMO coin was transferred to ${signer.account.address}`))
        }).catch(error => {
            console.error(error);
        });
    });

program.command('balance')
    .description('get the user balance of $DEMO coin')
    .action(async () => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const providerUrl = 'https://nodes.sequence.app/arbitrum-goerli';
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA,
            })
            
            const signer = session.account.getSigner(CHAIN_ID)
            const accountAddress = signer.account.address

            const balance = await indexer.getTokenBalances({
                contractAddress: contractAddress,
                accountAddress: accountAddress,
                includeMetadata: true
            })

            balance.balances.map((token: any) => {
                if(token.contractAddress == contractAddress){
                    console.log(chalk.cyan(`$DEMO balance: ${token.balance}`))
                }
            })
        })
    });

program.command('send')
    .description('send a certain number of tokens to a friends address')
    .argument('<amount>', 'amount to send')
    .argument('<address>', 'wallet address to send to')
    .action((amount, address, options) => {
        generateOrLoadPrivateKey().then(async (privateKey) => {
            const providerUrl = 'https://nodes.sequence.app/arbitrum-goerli';
            const provider = new ethers.providers.JsonRpcProvider(providerUrl);

            // Create your server EOA
            const walletEOA = new ethers.Wallet(privateKey, provider);

            // Open a Sequence session, this will find or create
            // a Sequence wallet controlled by your server EOA
            const session = await Session.singleSigner({
                signer: walletEOA,
            })
            
            const signer = session.account.getSigner(CHAIN_ID   )

            const erc20Interface = new ethers.utils.Interface([
                'function transfer(address to, uint256 value) public returns (bool)'
            ])
                
            const data = erc20Interface.encodeFunctionData(
                'transfer', [address, amount]
            )
                
            const txn = {
                to: contractAddress,
                data
            }

            try {
                const res = await signer.sendTransaction(txn)
                console.log(`Transaction ID: ${res.hash}`)
                console.log(`URL of Tx: https://goerli.arbiscan.io/tx/${res.hash}`)
            } catch(err) {
                console.log(`Something went wrong, check your inputs`)
                console.log(err)
            }
        }).catch(error => {
            console.error(`Failed to generate or load private key: ${error}`);
        });
});

program.parse();